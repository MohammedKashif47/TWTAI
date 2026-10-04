import fs from "node:fs/promises";
import {
  AlignmentType,
  BorderStyle,
  Document,
  Footer,
  Header,
  HeadingLevel,
  ImageRun,
  LineRuleType,
  NumberFormat,
  Packer,
  PageBreak,
  PageNumber,
  Paragraph,
  ShadingType,
  Tab,
  TabStopType,
  Table,
  TableCell,
  TableOfContents,
  TableRow,
  TextRun,
  WidthType,
  type ISectionOptions,
} from "docx";
import type { Feature, GuideSpec, Step } from "./spec.js";
import type { ImageAsset } from "./store.js";

/* ---------- Visual system ---------- */
const FONT = "Segoe UI";
const C = {
  text: "262626",
  muted: "595959",
  accent: "1F4E79",
  accent2: "2E75B6",
  rule: "BFBFBF",
  tableHead: "DEEAF6",
  note: { note: "2E75B6", tip: "548235", important: "BF8F00", caution: "C55A11", warning: "C00000" },
  noteFill: { note: "EEF4FA", tip: "EFF5EA", important: "FFF8E5", caution: "FCEFE6", warning: "FBE9E9" },
};
const CONTENT_WIDTH_TWIPS = 9360; // 6.5 in
const MAX_IMG_W = 576; // px at 96 dpi (6 in)
const MAX_IMG_W_INDENT = 504;
const MAX_IMG_H = 440;

/* ---------- Inline formatting: **bold**, *italic*, `code` ---------- */
export function inline(text: string, base: { size?: number; color?: string; italics?: boolean; bold?: boolean } = {}): TextRun[] {
  const runs: TextRun[] = [];
  const re = /(\*\*[^*]+\*\*|`[^`]+`|\*[^*\s][^*]*\*)/g;
  let last = 0;
  for (const m of text.matchAll(re)) {
    if (m.index! > last) runs.push(new TextRun({ text: text.slice(last, m.index), ...base }));
    const tok = m[0];
    if (tok.startsWith("**")) runs.push(new TextRun({ text: tok.slice(2, -2), ...base, bold: true }));
    else if (tok.startsWith("`")) runs.push(new TextRun({ text: tok.slice(1, -1), ...base, font: "Consolas" }));
    else runs.push(new TextRun({ text: tok.slice(1, -1), ...base, italics: true }));
    last = m.index! + tok.length;
  }
  if (last < text.length) runs.push(new TextRun({ text: text.slice(last), ...base }));
  return runs;
}

const p = (text: string, opts: Record<string, unknown> = {}) => new Paragraph({ children: inline(text), ...opts });

/** MSTP: complete sentences in steps end with a period. */
function sentence(t: string): string {
  const s = t.trim();
  return /[.:?!)"'\u201d]$/.test(s) || s.endsWith("**") && /[.:?!]\*\*$/.test(s) ? s : `${s}.`;
}

/*
 * Lists are written with their markers ("1.", "a.", "•") as real text plus a hanging indent,
 * instead of Word auto-numbering. They then show in every viewer (Word, LibreOffice, Google Docs,
 * browser and app previews), which do not all render Word list numbering.
 */
const LIST_INDENT = 360;

function listItem(marker: string, runs: TextRun[], level = 0, after = 60): Paragraph {
  const left = LIST_INDENT * (level + 1);
  return new Paragraph({
    children: [new TextRun({ text: marker }), new TextRun({ children: [new Tab()] }), ...runs],
    indent: { left, hanging: LIST_INDENT },
    tabStops: [{ type: TabStopType.LEFT, position: left }],
    spacing: { after },
  });
}

function bullets(items: string[], level = 0): Paragraph[] {
  return items.map((t) => listItem(level ? "\u2013" : "\u2022", inline(t), level));
}

function numbered(items: string[], level = 0): Paragraph[] {
  return items.map((t, i) => listItem(level ? `${String.fromCharCode(97 + (i % 26))}.` : `${i + 1}.`, inline(t), level));
}

/**
 * Turns text that contains Markdown-style lists into proper list paragraphs:
 * lines starting with "-", "*" or "•" become bullets, lines starting with "1." or "1)" become numbered items.
 */
function richText(text: string): Paragraph[] {
  const out: Paragraph[] = [];
  const lines = text.split(/\r?\n/);
  let buf: string[] = [];
  let bulletBuf: string[] = [];
  let numBuf: string[] = [];
  const flush = () => {
    if (buf.length) out.push(p(buf.join(" ")));
    if (bulletBuf.length) out.push(...bullets(bulletBuf));
    if (numBuf.length) out.push(...numbered(numBuf));
    buf = [];
    bulletBuf = [];
    numBuf = [];
  };
  for (const raw of lines) {
    const line = raw.trim();
    const b = line.match(/^[-*\u2022]\s+(.*)$/);
    const n = line.match(/^\d+[.)]\s+(.*)$/);
    if (!line) flush();
    else if (b) {
      if (buf.length || numBuf.length) flush();
      bulletBuf.push(b[1]);
    } else if (n) {
      if (buf.length || bulletBuf.length) flush();
      numBuf.push(n[1]);
    } else {
      if (bulletBuf.length || numBuf.length) flush();
      buf.push(line);
    }
  }
  flush();
  return out;
}

const paras = (texts: string[]) => texts.flatMap(richText);

interface Ctx {
  images: Map<string, ImageAsset>;
  figure: number;
  headings: { title: string; level: number }[];
  imageData: Map<string, Buffer>;
  numberHeadings: boolean;
  counters: number[];
  inAppendix: boolean;
}

/** Heading with an outline number: 1, 1.1, 1.1.1 in the body and A.1, A.1.1 in the appendix. */
function heading(ctx: Ctx, text: string, level: 1 | 2 | 3, pageBreakBefore = false): Paragraph {
  const map = { 1: HeadingLevel.HEADING_1, 2: HeadingLevel.HEADING_2, 3: HeadingLevel.HEADING_3 } as const;
  let num = "";
  if (ctx.numberHeadings) {
    const c = ctx.counters;
    c[level - 1]++;
    for (let i = level; i < 3; i++) c[i] = 0;
    if (level === 1 && ctx.inAppendix) num = "Appendix A";
    else {
      const first = ctx.inAppendix ? "A" : String(c[0]);
      num = [first, ...c.slice(1, level).map(String)].join(".");
    }
  }
  const label = num ? (level === 1 && ctx.inAppendix ? `${num}: ${text}` : `${num} ${text}`) : text;
  if (level <= 2) ctx.headings.push({ title: label, level });
  if (!num || (level === 1 && ctx.inAppendix)) {
    return new Paragraph({ text: label, heading: map[level], pageBreakBefore });
  }
  const tab = level === 1 ? 720 : level === 2 ? 864 : 1008;
  return new Paragraph({
    children: [new TextRun({ text: num }), new TextRun({ children: [new Tab()] }), new TextRun({ text })],
    heading: map[level],
    pageBreakBefore,
    tabStops: [{ type: TabStopType.LEFT, position: tab }],
    indent: { left: tab, hanging: tab },
  });
}

function noteBox(type: keyof typeof C.note, text: string, indent = 0): Paragraph {
  const label = { note: "Note", tip: "Tip", important: "Important", caution: "Caution", warning: "Warning" }[type];
  return new Paragraph({
    children: [new TextRun({ text: `${label}: `, bold: true, color: C.note[type] }), ...inline(text)],
    shading: { type: ShadingType.CLEAR, color: "auto", fill: C.noteFill[type] },
    border: { left: { style: BorderStyle.SINGLE, size: 24, color: C.note[type], space: 8 } },
    indent: { left: indent + 160, right: 160 },
    spacing: { before: 120, after: 160 },
  });
}

async function figure(ctx: Ctx, imageId: string, caption: string | undefined, indent = 0): Promise<Paragraph[]> {
  const img = ctx.images.get(imageId);
  if (!img) return [];
  let data = ctx.imageData.get(imageId);
  if (!data) {
    data = await fs.readFile(img.file);
    ctx.imageData.set(imageId, data);
  }
  const maxW = indent ? MAX_IMG_W_INDENT : MAX_IMG_W;
  const scale = Math.min(1, maxW / img.width, MAX_IMG_H / img.height);
  const width = Math.round(img.width * scale);
  const height = Math.round(img.height * scale);
  ctx.figure++;
  const cap = caption?.trim() || img.label;
  return [
    new Paragraph({
      children: [
        new ImageRun({
          type: "png",
          data,
          transformation: { width, height },
          altText: { name: imageId, title: cap, description: cap },
        }),
      ],
      indent: { left: indent },
      spacing: { before: 120, after: 60 },
      keepNext: true,
    }),
    new Paragraph({
      children: [new TextRun({ text: `Figure ${ctx.figure}. `, bold: true, size: 18, color: C.muted }), ...inline(cap, { size: 18, color: C.muted })],
      indent: { left: indent },
      spacing: { after: 200 },
    }),
  ];
}

async function steps(ctx: Ctx, list: Step[]): Promise<Paragraph[]> {
  const out: Paragraph[] = [];
  let n = 0;
  for (const s of list) {
    out.push(listItem(`${++n}.`, inline(sentence(s.text)), 0, 80));
    (s.substeps ?? []).forEach((sub, i) => out.push(listItem(`${String.fromCharCode(97 + (i % 26))}.`, inline(sentence(sub)), 1, 60)));
    if (s.result) out.push(new Paragraph({ children: inline(sentence(s.result)), indent: { left: LIST_INDENT }, spacing: { after: 100 } }));
    if (s.note) out.push(noteBox("note", s.note, LIST_INDENT));
    if (s.imageId) out.push(...(await figure(ctx, s.imageId, s.imageCaption, LIST_INDENT)));
  }
  return out;
}

function table(headers: string[], rows: string[][], widths: number[]): Table {
  const cell = (t: string, head: boolean, w: number) =>
    new TableCell({
      width: { size: w, type: WidthType.DXA },
      shading: head ? { type: ShadingType.CLEAR, color: "auto", fill: C.tableHead } : undefined,
      margins: { top: 60, bottom: 60, left: 100, right: 100 },
      children: [new Paragraph({ children: head ? [new TextRun({ text: t, bold: true })] : inline(t) })],
    });
  const border = { style: BorderStyle.SINGLE, size: 4, color: C.rule };
  return new Table({
    width: { size: CONTENT_WIDTH_TWIPS, type: WidthType.DXA },
    columnWidths: widths,
    borders: { top: border, bottom: border, left: border, right: border, insideHorizontal: border, insideVertical: border },
    rows: [
      new TableRow({ tableHeader: true, children: headers.map((h, i) => cell(h, true, widths[i])) }),
      ...rows.map((r) => new TableRow({ cantSplit: true, children: r.map((t, i) => cell(t, false, widths[i])) })),
    ],
  });
}

const spacer = () => new Paragraph({ text: "", spacing: { after: 120 } });

/* ---------- Sections ---------- */

function titlePage(spec: GuideSpec, date: string, company: string): Paragraph[] {
  const year = new Date().getFullYear();
  const meta: string[] = [];
  if (spec.productVersion) meta.push(`Product version ${spec.productVersion}`);
  meta.push(`Document version ${spec.documentVersion}`);
  meta.push(date);
  return [
    new Paragraph({ text: "", spacing: { before: 2400 } }),
    new Paragraph({ children: [new TextRun({ text: spec.productName.toUpperCase(), color: C.accent2, bold: true, size: 24, characterSpacing: 40 })], spacing: { after: 240 } }),
    new Paragraph({
      children: [new TextRun({ text: spec.title, color: C.accent, size: 56, bold: true })],
      border: { bottom: { style: BorderStyle.SINGLE, size: 18, color: C.accent2, space: 12 } },
      spacing: { after: 240 },
    }),
    ...(spec.subtitle ? [new Paragraph({ children: [new TextRun({ text: spec.subtitle, size: 30, color: C.muted })], spacing: { after: 480 } })] : []),
    new Paragraph({ children: [new TextRun({ text: "User Guide", size: 28, color: C.text })], spacing: { before: 240, after: 1200 } }),
    ...meta.map((m) => new Paragraph({ children: [new TextRun({ text: m, size: 20, color: C.muted })], spacing: { after: 40 } })),
    new Paragraph({ text: "", spacing: { before: 2400 } }),
    ...(company ? [new Paragraph({ children: [new TextRun({ text: company, bold: true, size: 20 })] })] : []),
    new Paragraph({
      children: [new TextRun({ text: `Copyright © ${year}${company ? ` ${company}` : ""}. All rights reserved.`, size: 16, color: C.muted })],
    }),
    new Paragraph({
      children: [
        new TextRun({
          text: "Information in this document is subject to change without notice. Screens shown are representative and can differ slightly from your version of the product.",
          size: 16,
          color: C.muted,
        }),
      ],
      spacing: { before: 80 },
    }),
  ];
}

async function introduction(ctx: Ctx, spec: GuideSpec): Promise<(Paragraph | Table)[]> {
  const i = spec.introduction;
  const out: (Paragraph | Table)[] = [heading(ctx, "Introduction", 1)];
  out.push(...paras(i.purpose));
  if (i.overviewImageId) out.push(...(await figure(ctx, i.overviewImageId, i.overviewImageCaption)));

  out.push(heading(ctx, "Who should read this guide", 2), ...richText(i.audience));
  if (i.scope?.length) {
    out.push(heading(ctx, "What this guide covers", 2), p("This guide describes the following features:"), ...bullets(i.scope));
  } else {
    out.push(heading(ctx, "What this guide covers", 2), p("This guide describes the following features:"), ...bullets(spec.features.map((f) => f.title)));
  }
  if (i.prerequisites?.length) out.push(heading(ctx, "Before you begin", 2), ...bullets(i.prerequisites));

  out.push(
    heading(ctx, "Document conventions", 2),
    p("This guide uses the following conventions:"),
    table(
      ["Convention", "Meaning"],
      [
        ["**Bold**", "Names of buttons, menus, fields, tabs, and other elements you select or see on the screen."],
        ["*Italic*", "New terms, and placeholders that you replace with your own value."],
        ["`Monospace`", "Text that you type, file names, and codes."],
        ["Numbered steps", "Procedures. Complete the steps in order."],
        ["**Note**, **Tip**, **Important**, **Caution**", "Supporting information. A caution or warning describes an action that can cause loss of data or an error."],
      ],
      [2600, CONTENT_WIDTH_TWIPS - 2600],
    ),
    spacer(),
  );
  return out;
}

async function featureSection(ctx: Ctx, f: Feature): Promise<(Paragraph | Table)[]> {
  const out: (Paragraph | Table)[] = [heading(ctx, f.title, 1, true)];
  out.push(...paras(f.overview));

  out.push(heading(ctx, `Go to ${stripMarks(f.title)}`, 2));
  out.push(p(f.navigation.intro ?? `To open ${stripMarks(f.title)} from the home screen, do the following:`));
  out.push(...(await steps(ctx, f.navigation.steps)));

  for (const d of f.details ?? []) {
    out.push(heading(ctx, d.heading, 2));
    out.push(...paras(d.paragraphs));
    if (d.bullets?.length) out.push(...bullets(d.bullets));
    if (d.imageId) out.push(...(await figure(ctx, d.imageId, d.imageCaption)));
  }

  if (f.uiElements?.length) {
    out.push(heading(ctx, "Screen elements", 2), p(`The following table describes the elements on the ${stripMarks(f.title)} screen.`));
    out.push(table(["Element", "Description"], f.uiElements.map((u) => [u.name.includes("**") ? u.name : `**${u.name}**`, u.description]), [2800, CONTENT_WIDTH_TWIPS - 2800]), spacer());
  }

  for (const pr of f.procedures ?? []) {
    out.push(heading(ctx, pr.title, 2));
    if (pr.intro) out.push(...richText(pr.intro));
    if (pr.prerequisites?.length) {
      out.push(new Paragraph({ children: [new TextRun({ text: "Before you begin", bold: true })], spacing: { before: 60 } }), ...bullets(pr.prerequisites));
    }
    out.push(...(await steps(ctx, pr.steps)));
  }

  for (const n of f.notes ?? []) out.push(noteBox(n.type, n.text));
  for (const im of f.images ?? []) out.push(...(await figure(ctx, im.imageId, im.caption)));
  return out;
}

function appendix(ctx: Ctx, spec: GuideSpec): (Paragraph | Table)[] {
  const a = spec.appendix;
  ctx.inAppendix = true;
  const out: (Paragraph | Table)[] = [heading(ctx, "Reference information", 1, true)];

  out.push(heading(ctx, "Contact information", 2));
  if (a.contacts.length) {
    out.push(p("Use the following contacts for help with the product or this guide."));
    for (const c of a.contacts) {
      out.push(new Paragraph({ children: [new TextRun({ text: c.role, bold: true, color: C.accent })], spacing: { before: 160, after: 40 }, keepNext: true }));
      const rows: [string, string | undefined][] = [
        ["Name", c.name],
        ["Email", c.email],
        ["Phone", c.phone],
        ["Hours", c.hours],
        ["Web", c.url],
      ];
      for (const [k, v] of rows) if (v) out.push(new Paragraph({ children: [new TextRun({ text: `${k}: `, color: C.muted }), ...inline(v)], indent: { left: 240 }, spacing: { after: 20 } }));
    }
  } else {
    out.push(p("Contact your system administrator for help with the product."));
  }

  if (a.troubleshooting?.length) {
    out.push(heading(ctx, "Troubleshooting", 2));
    out.push(table(["Problem", "Solution"], a.troubleshooting.map((t) => [t.problem, t.solution]), [3600, CONTENT_WIDTH_TWIPS - 3600]), spacer());
  }
  if (a.glossary?.length) {
    out.push(heading(ctx, "Glossary", 2));
    const sorted = [...a.glossary].sort((x, y) => x.term.localeCompare(y.term));
    out.push(table(["Term", "Definition"], sorted.map((g) => [`**${g.term}**`, g.definition]), [2600, CONTENT_WIDTH_TWIPS - 2600]), spacer());
  }
  for (const s of a.additional ?? []) {
    out.push(heading(ctx, s.heading, 2), ...paras(s.paragraphs));
    if (s.bullets?.length) out.push(...bullets(s.bullets));
  }
  if (a.references?.length) {
    out.push(heading(ctx, "Related documents", 2), ...bullets(a.references.map((r) => (r.url ? `${r.title}: ${r.url}` : r.title))));
  }
  return out;
}

function stripMarks(s: string): string {
  return s.replace(/\*\*|`|\*/g, "");
}

/* ---------- Document ---------- */

export async function buildDocx(spec: GuideSpec, images: ImageAsset[], outFile: string, company: string): Promise<{ figures: number; headings: number }> {
  const ctx: Ctx = {
    images: new Map(images.map((i) => [i.id, i])),
    figure: 0,
    headings: [],
    imageData: new Map(),
    numberHeadings: spec.numberHeadings ?? true,
    counters: [0, 0, 0],
    inAppendix: false,
  };
  const date = spec.publishDate || new Date().toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" });

  const body: (Paragraph | Table)[] = [...(await introduction(ctx, spec))];
  for (const f of spec.features) body.push(...(await featureSection(ctx, f)));
  body.push(...appendix(ctx, spec));

  const header = new Header({
    children: [
      new Paragraph({
        alignment: AlignmentType.RIGHT,
        children: [new TextRun({ text: spec.title, size: 16, color: C.muted })],
        border: { bottom: { style: BorderStyle.SINGLE, size: 4, color: C.rule, space: 4 } },
      }),
    ],
  });
  const footer = new Footer({
    children: [
      new Paragraph({
        alignment: AlignmentType.CENTER,
        children: [new TextRun({ children: [PageNumber.CURRENT], size: 18, color: C.muted })],
      }),
    ],
  });
  const page = { margin: { top: 1440, bottom: 1440, left: 1440, right: 1440, header: 708, footer: 708 }, size: { width: 12240, height: 15840 } };

  const sections: ISectionOptions[] = [
    { properties: { page }, children: titlePage(spec, date, company) },
    {
      properties: { page: { ...page, pageNumbers: { start: 1, formatType: NumberFormat.LOWER_ROMAN } } },
      headers: { default: header },
      footers: { default: footer },
      children: [
        new Paragraph({ children: [new TextRun({ text: "Contents", bold: true, size: 36, color: C.accent })], spacing: { after: 240 } }),
        new TableOfContents("Contents", {
          hyperlink: true,
          headingStyleRange: "1-2",
          cachedEntries: ctx.headings.map((h) => ({ title: h.title, level: h.level })),
        }),
        new Paragraph({ children: [new PageBreak()] }),
      ],
    },
    {
      properties: { page: { ...page, pageNumbers: { start: 1, formatType: NumberFormat.DECIMAL } } },
      headers: { default: header },
      footers: { default: footer },
      children: body,
    },
  ];

  const doc = new Document({
    title: spec.title,
    subject: `${spec.productName} user guide`,
    creator: company || spec.productName,
    description: spec.subtitle ?? spec.title,
    features: { updateFields: true },
    styles: {
      default: {
        document: { run: { font: FONT, size: 21, color: C.text }, paragraph: { spacing: { after: 140, line: 276, lineRule: LineRuleType.AUTO } } },
        heading1: {
          run: { font: FONT, size: 36, bold: true, color: C.accent },
          paragraph: { spacing: { before: 240, after: 200 }, keepNext: true, keepLines: true },
        },
        heading2: {
          run: { font: FONT, size: 28, bold: true, color: C.accent2 },
          paragraph: { spacing: { before: 280, after: 120 }, keepNext: true, keepLines: true },
        },
        heading3: {
          run: { font: FONT, size: 23, bold: true, color: C.text },
          paragraph: { spacing: { before: 200, after: 80 }, keepNext: true },
        },
      },
      paragraphStyles: [
        { id: "TOC1", name: "toc 1", basedOn: "Normal", next: "Normal", run: { bold: true }, paragraph: { spacing: { before: 120, after: 40 } } },
        { id: "TOC2", name: "toc 2", basedOn: "Normal", next: "Normal", paragraph: { indent: { left: 360 }, spacing: { after: 20 } } },
      ],
    },
    sections,
  });

  await fs.writeFile(outFile, await Packer.toBuffer(doc));
  return { figures: ctx.figure, headings: ctx.headings.length };
}
