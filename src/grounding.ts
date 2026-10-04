/**
 * Grounding checks: keep the guide inside the scope of the Jira issue and its linked sources,
 * and measure how much of the source content the guide explains.
 *
 * Errors block the build (content with no support in the sources).
 * Warnings and the coverage report steer Claude toward elaborating everything the sources say.
 */
import { config } from "./config.js";
import type { GuideSpec } from "./spec.js";
import type { SourceBundle } from "./store.js";

export interface GroundingResult {
  errors: string[];
  warnings: string[];
  coverage: { percent: number; covered: number; total: number; uncovered: { sourceId: string; fact: string }[] };
}

/* ---------------- text helpers ---------------- */

export function norm(s: string): string {
  return s
    .toLowerCase()
    .replace(/[‘’‛]/g, "'")
    .replace(/[“”„]/g, '"')
    .replace(/[–—]/g, "-")
    .replace(/\\([[\]()*_`#>|.!-])/g, "$1")
    .replace(/[*`]|(?<![a-z0-9])_|_(?![a-z0-9])/g, "")
    .replace(/[#>|]/g, " ")
    .replace(/\s+/g, " ")
    .replace(/\s+([.,;:!?)\]])/g, "$1")
    .replace(/([(\[])\s+/g, "$1")
    .trim();
}

const STOP = new Set(
  (
    "a an the and or but if then than that this these those to of in on at by for from with without into onto over under " +
    "is are was were be been being it its as so can could should would will may might must do does did done you your yours " +
    "we our they their them he she his her i me my not no yes all any each every some such more most other also only " +
    "when where which who whom what how why there here up down out about after before between through during while " +
    "has have had use used using via per new one two"
  ).split(" "),
);

/** Words that can appear in headings without saying anything about the topic. */
const GENERIC = new Set(
  (
    "overview introduction guide section screen page element elements detail details information about go open view " +
    "work works working manage managing understand understanding feature features option options step steps use using " +
    "access accessing navigate navigating main general basic common reference available"
  ).split(" "),
);

/** Everyday documentation vocabulary that explanations need; neutral when judging whether a sentence is supported. */
const DOC_VOCAB = new Set(
  (
    "select click choose enter type press appear appears display displays show shows open opens close closes list button field box " +
    "dialog menu tab link page screen window pane panel section option value want need able let lets help helps allow allows following " +
    "describe describes explain explains table figure step steps first next then also user users guide information see find make makes " +
    "available current once after before start end left right top bottom area view part include includes contain contains same different " +
    "like example such time"
  )
    .split(" ")
    .map((w) => w),
);

export function stem(w: string): string {
  let s = w.toLowerCase();
  for (const suf of ["ational", "ations", "ation", "ments", "ment", "ings", "ing", "edly", "ies", "ied", "ed", "es", "ly", "er", "s"]) {
    if (s.length - suf.length >= 3 && s.endsWith(suf)) {
      s = s.slice(0, -suf.length);
      if (suf === "ies" || suf === "ied") s += "y";
      break;
    }
  }
  return s;
}

function words(s: string): string[] {
  return norm(s).match(/[a-z0-9]+/g) ?? [];
}

function contentStems(s: string): string[] {
  return words(s)
    .filter((w) => w.length >= 3 && !STOP.has(w) && !/^\d+$/.test(w))
    .map(stem);
}

/* ---------------- corpus ---------------- */

interface Corpus {
  bySource: Map<string, string>; // normalized text per source id (images included as image:<id>)
  all: string; // normalized concatenation
  stems: Set<string>;
  digits: string; // all digits, for phone numbers
}

function buildCorpus(bundle: SourceBundle): Corpus {
  const bySource = new Map<string, string>();
  for (const s of bundle.sources) bySource.set(s.id, norm(`${s.title}\n${s.text ?? ""}`));
  for (const i of bundle.images) {
    if (i.visibleText) {
      const t = norm(i.visibleText);
      bySource.set(`image:${i.id}`, t);
      // Text read off a screenshot also counts toward the source the screenshot came from.
      bySource.set(i.sourceId, `${bySource.get(i.sourceId) ?? ""} ${t}`);
    }
  }
  const all = [...bySource.values()].join(" \n ");
  return { bySource, all, stems: new Set(contentStems(all)), digits: all.replace(/\D/g, "") };
}

/** True when the quote appears in the source (or, if the source id is unknown, anywhere). "..." splits a quote into parts. */
function quoteFound(c: Corpus, sourceId: string, quote: string): boolean {
  const hay = c.bySource.get(sourceId) ?? "";
  const parts = quote
    .split(/\.{3}|…/)
    .map(norm)
    .filter((p) => p.length > 0);
  if (!parts.length || parts.join(" ").length < 12) return false;
  return parts.every((p) => hay.includes(p));
}

/* ---------------- facts for coverage ---------------- */

const META_LINE =
  /^(issue type|status|priority|project|parent|labels?|components?|fix versions?|affects versions?|assignee|reporter|creator|environment|sprint|story points?|file key|figma node|pages|url|title|source|characters|images from this source|created|updated|resolution)\s*:/i;

export function extractFacts(text: string): string[] {
  const out = new Set<string>();
  for (let line of text.split(/\r?\n/)) {
    line = line
      .replace(/^\s*(?:[-*+•]|\d+[.)])\s+/, "")
      .replace(/^#+\s*/, "")
      .replace(/\*\*/g, "")
      .trim();
    if (!line || META_LINE.test(line) || /^https?:\/\/\S+$/.test(line) || /^\|?\s*-{3,}/.test(line)) continue;
    if (/^[A-Z][A-Z0-9_]+-\d+\s*:/.test(line)) continue; // issue title line ("KAN-20: ...")
    // Drop field labels such as "Acceptance Criteria:" or "Comment from Priya (PO):" and issue keys.
    line = line.replace(/^[A-Z][\w ()'.-]{0,40}:\s+(?=\S)/, "").replace(/\b[A-Z][A-Z0-9_]+-\d+\b/g, "").trim();
    if (!line) continue;
    for (const sentence of line.split(/(?<=[.!?])\s+(?=[A-Z0-9"'])/)) {
      const s = sentence.trim();
      if (s.split(/\s+/).length >= 5 && contentStems(s).length >= 3) out.add(s);
    }
  }
  return [...out];
}

/* ---------------- spec text helpers ---------------- */

/** Fields that are not explanatory text: ids, links, and title-page values chosen by the writer. */
const SKIP_KEYS = new Set([
  "imageId", "overviewImageId", "url", "sourceId", "quote", "outputFileName", "title", "subtitle", "productName",
  "productVersion", "documentVersion", "publishDate", "companyName", "role", "name", "email", "phone", "hours",
]);

function allSpecText(spec: GuideSpec): string {
  const parts: string[] = [];
  const visit = (v: unknown, key = ""): void => {
    if (typeof v === "string") {
      if (!SKIP_KEYS.has(key)) parts.push(v);
    } else if (Array.isArray(v)) v.forEach((x) => visit(x, key));
    else if (v && typeof v === "object") for (const [k, x] of Object.entries(v)) if (k !== "evidence" && k !== "sourceIds") visit(x, k);
  };
  visit(spec);
  return parts.join("\n");
}

const FILLER = [
  "seamless", "seamlessly", "comprehensive", "robust", "user-friendly", "intuitive", "cutting-edge", "state-of-the-art",
  "powerful", "effortless", "effortlessly", "leverage", "best practices", "world-class", "streamline", "revolutionize",
  "elevate", "delve", "game-changer", "next-generation", "industry-leading", "unparalleled", "with ease",
];

/* ---------------- main check ---------------- */

export function checkGrounding(spec: GuideSpec, bundle: SourceBundle): GroundingResult {
  const errors: string[] = [];
  const warnings: string[] = [];
  const c = buildCorpus(bundle);

  const empty = bundle.sources.filter((s) => !(s.text ?? "").trim());
  if (!bundle.sources.length) {
    errors.push("No sources are registered. Register every Jira issue, Confluence page and Figma design you read with register_source (including its content).");
  } else if (empty.length) {
    errors.push(
      `These sources were registered without their content, so the guide cannot be checked against them: ${empty.map((s) => s.id).join(", ")}. ` +
        "Call register_source again for each one and pass the full text you read in `content`.",
    );
  }

  const productStems = new Set(contentStems(spec.productName));
  const checkEvidence = (where: string, ev: { sourceId: string; quote: string }[] | undefined): void => {
    if (!ev?.length) {
      errors.push(`${where}: no evidence. Add at least one { sourceId, quote } copied word for word from a source, or remove this content because it is out of scope.`);
      return;
    }
    const bad = ev.filter((e) => !quoteFound(c, e.sourceId, e.quote));
    if (bad.length === ev.length) {
      errors.push(
        `${where}: none of the evidence quotes were found in the cited sources (${bad.map((b) => `${b.sourceId}: "${b.quote.slice(0, 60)}"`).join("; ")}). ` +
          "Quote the source text exactly, or remove this content because the sources do not support it.",
      );
    } else if (bad.length) {
      warnings.push(`${where}: ${bad.length} evidence quote(s) were not found in the cited source and were ignored.`);
    }
  };
  const checkTopic = (where: string, heading: string): void => {
    const topical = contentStems(heading).filter((s) => !GENERIC.has(s) && !productStems.has(s));
    if (topical.length && !topical.some((s) => c.stems.has(s))) {
      errors.push(
        `${where}: the topic "${heading}" does not appear in any source (${topical.join(", ")} not found). ` +
          "Remove this section: the guide must stay within the scope of the Jira issue and its linked pages and designs.",
      );
    }
  };

  /* Features and their parts */
  spec.features.forEach((f, fi) => {
    const w = `features[${fi}] "${f.title}"`;
    checkTopic(w, f.title);
    checkEvidence(w, f.evidence);
    f.details?.forEach((d, di) => {
      checkTopic(`${w} details[${di}]`, d.heading);
      checkEvidence(`${w} details[${di}] "${d.heading}"`, d.evidence);
    });
    f.procedures?.forEach((p, pi) => {
      checkTopic(`${w} procedures[${pi}]`, p.title);
      checkEvidence(`${w} procedures[${pi}] "${p.title}"`, p.evidence);
    });
    f.notes?.forEach((n, ni) => checkEvidence(`${w} notes[${ni}] "${n.text.slice(0, 50)}"`, n.evidence));
    f.uiElements?.forEach((u) => {
      const st = contentStems(u.name).filter((s) => !GENERIC.has(s));
      const found = st.filter((s) => c.stems.has(s)).length;
      if (st.length && found / st.length < 0.5) {
        errors.push(`${w} screen element "${u.name}" is not named in any source or recorded screenshot text. Use the label exactly as the product shows it, or remove the row.`);
      }
    });
  });

  /* Appendix */
  spec.appendix.additional?.forEach((s, i) => checkTopic(`appendix.additional[${i}]`, s.heading));
  spec.appendix.troubleshooting?.forEach((t, i) => checkEvidence(`appendix.troubleshooting[${i}] "${t.problem.slice(0, 50)}"`, t.evidence));
  spec.appendix.glossary?.forEach((g) => {
    if (!c.all.includes(norm(g.term))) errors.push(`Glossary term "${g.term}" does not appear in the sources. Only define terms the sources use.`);
  });
  const d = config.defaults;
  const defaults = norm([d.companyName, d.supportEmail, d.supportPhone, d.supportHours, d.supportUrl].join(" "));
  const defaultDigits = defaults.replace(/\D/g, "");
  spec.appendix.contacts.forEach((ct) => {
    for (const [k, v] of Object.entries({ name: ct.name, email: ct.email, url: ct.url })) {
      if (v && !c.all.includes(norm(v)) && !defaults.includes(norm(v))) errors.push(`Contact "${ct.role}" ${k} "${v}" is not in the sources or the configured defaults. Do not invent contact details.`);
    }
    if (ct.phone) {
      const digits = ct.phone.replace(/\D/g, "");
      if (digits && !c.digits.includes(digits) && !defaultDigits.includes(digits)) errors.push(`Contact "${ct.role}" phone "${ct.phone}" is not in the sources or the configured defaults.`);
    }
  });

  /* Unsupported specifics in the text */
  const text = allSpecText(spec);
  const missingLabels = new Set<string>();
  for (const m of text.matchAll(/\*\*([^*]+)\*\*/g)) {
    const label = m[1].trim();
    if (label.length > 1 && !c.all.includes(norm(label))) missingLabels.add(label);
  }
  if (missingLabels.size) {
    warnings.push(
      `UI labels in bold that do not appear in any source or recorded screenshot text: ${[...missingLabels].slice(0, 25).join(", ")}. ` +
        "Use labels exactly as the product shows them. If you read them from a screenshot, record them with record_image_text.",
    );
  }
  const missingNumbers = new Set<string>();
  for (const m of text.matchAll(/\b\d[\d,.:/-]*\d\b|\b\d{2,}\b/g)) {
    const n = m[0];
    if (!c.all.includes(n.toLowerCase())) missingNumbers.add(n);
  }
  if (missingNumbers.size) {
    warnings.push(`Numbers, limits or versions that do not appear in the sources: ${[...missingNumbers].slice(0, 20).join(", ")}. Remove them unless a source states them.`);
  }
  const missingTerms = new Set<string>();
  for (const m of text.matchAll(/(?<![.!?:]\s|^|\n)\b([A-Z][a-zA-Z0-9]+(?:[ \t]+[A-Z][a-zA-Z0-9]+)*)/g)) {
    const term = m[1];
    if (/^(I|You|Note|Tip|Important|Caution|Warning|Figure|Appendix|Before|After|For|To|If|When|The|This|On|In|Select|Enter)$/.test(term)) continue;
    if (!c.all.includes(norm(term)) && !contentStems(term).every((s) => c.stems.has(s))) missingTerms.add(term);
  }
  if (missingTerms.size) {
    warnings.push(`Names and terms that do not appear in the sources: ${[...missingTerms].slice(0, 25).join(", ")}. Check each one; remove anything the sources do not mention.`);
  }
  const filler = FILLER.filter((f) => new RegExp(`\\b${f.replace(/[-]/g, "[- ]")}\\b`, "i").test(text) && !c.all.includes(f));
  /* Sentences whose content words are mostly absent from the sources */
  const vocab = new Set([...DOC_VOCAB].map(stem));
  const weak: string[] = [];
  for (const sentence of text.split(/(?<=[.!?])\s+|\n+/)) {
    const st = contentStems(sentence).filter((x) => !vocab.has(x) && !productStems.has(x));
    if (st.length < 4) continue;
    const support = st.filter((x) => c.stems.has(x)).length / st.length;
    if (support < 0.5) weak.push(sentence.trim().replace(/\*\*/g, ""));
  }
  if (weak.length) {
    warnings.push(
      `Sentences that the sources barely support (most of their key words are not in any source). Remove them or rewrite them from source facts: ${weak
        .slice(0, 15)
        .map((w) => `"${w.slice(0, 120)}"`)
        .join("; ")}${weak.length > 15 ? ` and ${weak.length - 15} more` : ""}.`,
    );
  }

  if (filler.length) warnings.push(`Marketing or filler words that add no information: ${filler.join(", ")}. Replace them with the specific facts from the sources.`);

  /* Coverage: how much of the source content the guide explains */
  const guideStems = new Set(contentStems(text));
  const guideNorm = norm(text);
  const facts: { sourceId: string; fact: string }[] = [];
  for (const s of bundle.sources) for (const f of extractFacts(s.text ?? "")) facts.push({ sourceId: s.id, fact: f });
  const uncovered = facts.filter(({ fact }) => {
    // Specific values (quoted messages and labels, numbers) must be carried over exactly.
    const specifics = [
      ...[...fact.matchAll(/["\u201c]([^"\u201d]{2,80})["\u201d]/g)].map((m) => norm(m[1])),
      ...(fact.match(/\b\d[\d,.:]*\d\b|\b\d{2,}\b/g) ?? []),
    ];
    if (specifics.some((v) => !guideNorm.includes(v.toLowerCase()))) return true;
    const st = contentStems(fact);
    return st.filter((x) => guideStems.has(x)).length / st.length < 0.7;
  });
  const covered = facts.length - uncovered.length;
  const percent = facts.length ? Math.round((covered / facts.length) * 100) : 100;
  if (facts.length && percent < 80) {
    warnings.push(
      `The guide explains about ${percent}% of the statements in the sources. Work through "coverage.uncovered" and explain each user-relevant statement in the right section. Skip only tracking noise such as developer notes, test tasks and status updates.`,
    );
  }

  return { errors, warnings, coverage: { percent, covered, total: facts.length, uncovered: uncovered.slice(0, 40) } };
}
