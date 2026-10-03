import type { GuideSpec } from "./spec.js";

export interface LintResult {
  errors: string[];
  warnings: string[];
}

const JIRA_KEY = /\b[A-Z][A-Z0-9_]+-\d+\b/;

/** Microsoft Writing Style Guide (MSTP successor) terms and patterns to avoid in user-facing text. */
const STYLE_RULES: { re: RegExp; advice: string }[] = [
  { re: /\bclick on\b/i, advice: 'Use "select" (or "click") without "on".' },
  { re: /\bclick here\b/i, advice: 'Avoid "click here"; name the link or button.' },
  { re: /\bplease\b/i, advice: 'Avoid "please" in instructions.' },
  { re: /\bsimply\b|\bjust\b|\beasily\b|\bobviously\b/i, advice: 'Drop "simply/just/easily/obviously".' },
  { re: /\be\.g\.|\bi\.e\.|\betc\.|\bvia\b|\bvs\.?\b/i, advice: 'Avoid Latin abbreviations: use "for example", "that is", "and so on", "through", "versus".' },
  { re: /\butiliz(e|es|ed|ing)\b|\butilization\b/i, advice: 'Use "use".' },
  { re: /\bin order to\b/i, advice: 'Use "to".' },
  { re: /\bhit\b(?! rate)/i, advice: 'Use "press" for keys or "select" for UI.' },
  { re: /\blog ?in to\b|\blogin to\b/i, advice: 'Use "sign in to".' },
  { re: /\blog ?out\b|\blogout\b/i, advice: 'Use "sign out".' },
  { re: /\bcheck the checkbox\b|\btick\b/i, advice: 'Use "select the X check box".' },
  { re: /\bdrop-?down (menu|list)? ?box\b/i, advice: 'Use "list" or "menu".' },
  { re: /\bwill be (displayed|shown|opened)\b/i, advice: 'Use present tense: "appears", "opens".' },
  { re: /\bshould be able to\b|\bwill be able to\b/i, advice: 'Use present tense: "you can".' },
  { re: /\bthe user\b/i, advice: 'Address the reader as "you" in instructions.' },
  { re: /\bpop-?up\b/i, advice: 'Use "dialog box" or "window".' },
  { re: /\bnavigate to\b/i, advice: 'Prefer "go to" (MSTP), unless it is the section label.' },
  { re: /!\s*$/, advice: "Avoid exclamation marks." },
];

function eachText(spec: GuideSpec, cb: (where: string, value: string) => void): void {
  const visit = (v: unknown, where: string): void => {
    if (typeof v === "string") cb(where, v);
    else if (Array.isArray(v)) v.forEach((x, i) => visit(x, `${where}[${i}]`));
    else if (v && typeof v === "object") for (const [k, x] of Object.entries(v)) if (!["imageId", "url", "sourceIds", "outputFileName", "email", "evidence"].includes(k)) visit(x, where ? `${where}.${k}` : k);
  };
  visit(spec, "");
}

export function lintSpec(spec: GuideSpec, knownImageIds: Set<string>): LintResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  // Title rules
  if (JIRA_KEY.test(spec.title) || /\b(jira|ticket|story|epic)\b/i.test(spec.title)) {
    errors.push(`Title "${spec.title}" mentions a Jira key or Jira wording. Use a descriptive product/feature title.`);
  }
  if (spec.title.length > 90) warnings.push("Title is longer than 90 characters; consider a shorter title and a subtitle.");
  if (spec.subtitle && JIRA_KEY.test(spec.subtitle)) errors.push("Subtitle contains a Jira key.");

  // Image references must exist
  const checkImg = (id: string | undefined, where: string) => {
    if (id && !knownImageIds.has(id)) errors.push(`${where}: image "${id}" was not collected. Known ids: ${[...knownImageIds].join(", ") || "none"}.`);
  };
  checkImg(spec.introduction.overviewImageId, "introduction");
  spec.features.forEach((f, fi) => {
    const w = `features[${fi}] "${f.title}"`;
    f.navigation.steps.forEach((s, i) => checkImg(s.imageId, `${w} navigation step ${i + 1}`));
    f.procedures?.forEach((p) => p.steps.forEach((s, i) => checkImg(s.imageId, `${w} "${p.title}" step ${i + 1}`)));
    f.details?.forEach((d) => checkImg(d.imageId, `${w} "${d.heading}"`));
    f.images?.forEach((im) => checkImg(im.imageId, `${w} images`));

    const first = f.navigation.steps[0]?.text ?? "";
    if (!/home|dashboard|start|landing|sign in|launch|open/i.test(first + (f.navigation.intro ?? ""))) {
      warnings.push(`${w}: navigation should start from the home screen; the first step is "${first}".`);
    }
    const allSteps = [...f.navigation.steps, ...(f.procedures ?? []).flatMap((p) => p.steps)];
    allSteps.forEach((s) => {
      if (/\band then\b|;\s*then\b/i.test(s.text)) warnings.push(`${w}: step "${s.text}" combines actions; use one action per step.`);
      if (!/^\s*(\*\*|[A-Z])/.test(s.text)) warnings.push(`${w}: step "${s.text}" should start with an imperative verb.`);
    });
    if (f.overview.join(" ").length < 120) warnings.push(`${w}: overview is very short; explain what the feature does and why.`);
  });

  // Style rules across all user-facing text
  const hits = new Map<string, string[]>();
  eachText(spec, (where, value) => {
    if (JIRA_KEY.test(value) && !where.startsWith("appendix.references") && !where.includes("sourceIds")) {
      warnings.push(`${where}: contains a Jira key ("${value.match(JIRA_KEY)![0]}"). Keep issue keys out of user-facing text.`);
    }
    for (const r of STYLE_RULES) {
      if (r.re.test(value)) {
        const list = hits.get(r.advice) ?? [];
        list.push(where);
        hits.set(r.advice, list);
      }
    }
  });
  for (const [advice, where] of hits) {
    warnings.push(`Style: ${advice} Found in ${where.slice(0, 5).join(", ")}${where.length > 5 ? ` and ${where.length - 5} more` : ""}.`);
  }

  if (!spec.appendix.contacts.length) warnings.push("Appendix has no contact details.");
  return { errors, warnings };
}
