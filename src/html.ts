import TurndownService from "turndown";

const turndown = new TurndownService({ headingStyle: "atx", bulletListMarker: "-", codeBlockStyle: "fenced" });

// Keep simple tables readable as pipe rows instead of dropping them.
turndown.addRule("tableCell", {
  filter: ["th", "td"],
  replacement: (content) => ` ${content.replace(/\n+/g, " ").trim()} |`,
});
turndown.addRule("tableRow", {
  filter: "tr",
  replacement: (content) => `\n|${content}`,
});
turndown.addRule("table", {
  filter: "table",
  replacement: (content) => `\n${content}\n\n`,
});
// Confluence storage format: images and attachments become readable placeholders.
turndown.addRule("acImage", {
  filter: (node) => node.nodeName.toLowerCase() === "ac:image",
  replacement: (_c, node) => {
    const el = node as unknown as Element;
    const att = el.querySelector?.("ri\\:attachment, attachment");
    const name = att?.getAttribute("ri:filename") ?? "";
    return name ? `\n[Image: ${name}]\n` : "\n[Image]\n";
  },
});
// Confluence macros: keep their body text, label notes/warnings.
turndown.addRule("acMacro", {
  filter: (node) => node.nodeName.toLowerCase() === "ac:structured-macro",
  replacement: (content, node) => {
    const name = (node as unknown as Element).getAttribute?.("ac:name") ?? "macro";
    const labelled = ["info", "note", "warning", "tip", "panel"].includes(name);
    return labelled ? `\n> **${name.toUpperCase()}:** ${content.trim()}\n` : `\n${content.trim()}\n`;
  },
});
turndown.addRule("acParam", {
  filter: (node) => node.nodeName.toLowerCase() === "ac:parameter",
  replacement: () => "",
});

export function htmlToMarkdown(html: string | null | undefined): string {
  if (!html) return "";
  try {
    return turndown.turndown(html).replace(/\n{3,}/g, "\n\n").trim();
  } catch {
    return html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
  }
}
