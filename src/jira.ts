import { atlassianGet, atlassianPost } from "./http.js";
import { htmlToMarkdown } from "./html.js";
import { extractUrls } from "./links.js";

/* eslint-disable @typescript-eslint/no-explicit-any */

export interface JiraAttachment {
  id: string;
  filename: string;
  mimeType: string;
  size: number;
  content: string;
}

export interface JiraIssueData {
  key: string;
  url: string;
  summary: string;
  markdown: string;
  attachments: JiraAttachment[];
  subtaskKeys: string[];
  linkedKeys: { key: string; relation: string }[];
  urls: string[];
}

// Fields that only carry tracking noise and never help a user guide.
const SKIP_FIELD_NAMES = new Set(
  [
    "Rank", "Development", "Watchers", "Votes", "Last Viewed", "Updated", "Created", "Status Category Changed",
    "Work Ratio", "Time tracking", "Σ Time Spent", "Σ Original Estimate", "Σ Remaining Estimate", "Log Work",
    "Status Category", "Issue color", "Vulnerability", "Request participants", "Satisfaction", "Approvals",
    "Restrict to", "Flagged", "Team", "Start date", "Due date", "Resolved", "[CHART] Date of First Response",
    "[CHART] Time in Status", "Comment", "Attachment", "Sub-tasks", "Linked Issues", "Description", "Summary",
    "Worklog", "Progress", "Σ Progress", "Remaining Estimate", "Original Estimate", "Time Spent", "Project",
    "Issue Type", "Status", "Priority", "Labels", "Components", "Fix versions", "Affects versions", "Assignee",
    "Reporter", "Creator", "Parent", "Resolution", "Security Level", "Environment", "Sprint", "Story point estimate",
    "Story Points", "Epic Link", "Epic Name", "Epic Status", "Epic Colour", "Issue Type Hierarchy",
  ].map((s) => s.toLowerCase()),
);

function valueToText(v: any): string {
  if (v == null) return "";
  if (typeof v === "string") return v;
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  if (Array.isArray(v)) return v.map(valueToText).filter(Boolean).join(", ");
  if (typeof v === "object") {
    if (v.type === "doc" && Array.isArray(v.content)) return adfToText(v);
    return v.displayName ?? v.value ?? v.name ?? v.title ?? v.key ?? "";
  }
  return "";
}

/** Minimal ADF to text, used only when Jira did not return a rendered HTML version. */
export function adfToText(node: any): string {
  if (!node) return "";
  if (node.type === "text") return node.text ?? "";
  if (node.type === "hardBreak") return "\n";
  if (node.type === "inlineCard" || node.type === "blockCard" || node.type === "embedCard") return node.attrs?.url ?? "";
  if (node.type === "mention") return node.attrs?.text ?? "";
  if (node.type === "mediaSingle" || node.type === "mediaGroup") return "\n[Image]\n";
  const inner = (node.content ?? []).map(adfToText).join("");
  switch (node.type) {
    case "paragraph":
      return inner + "\n\n";
    case "heading":
      return "#".repeat(node.attrs?.level ?? 2) + " " + inner + "\n\n";
    case "listItem":
      return "- " + inner.trim() + "\n";
    case "bulletList":
    case "orderedList":
      return inner + "\n";
    case "tableRow":
      return "|" + (node.content ?? []).map((c: any) => " " + adfToText(c).trim().replace(/\n+/g, " ") + " |").join("") + "\n";
    default:
      return inner;
  }
}

function people(v: any): string {
  return v?.displayName ?? "";
}

export async function fetchIssue(key: string, opts: { includeComments: boolean }): Promise<JiraIssueData> {
  const issue = await atlassianGet<any>(
    `/rest/api/3/issue/${encodeURIComponent(key)}?expand=renderedFields,names&fields=*all`,
  );
  const f = issue.fields ?? {};
  const r = issue.renderedFields ?? {};
  const names: Record<string, string> = issue.names ?? {};
  const baseUrl = new URL(issue.self).origin;
  const url = `${baseUrl}/browse/${issue.key}`;

  const lines: string[] = [];
  lines.push(`# ${issue.key}: ${f.summary ?? ""}`);
  const meta: [string, string][] = [
    ["Issue type", f.issuetype?.name],
    ["Status", f.status?.name],
    ["Priority", f.priority?.name],
    ["Project", f.project?.name],
    ["Parent", f.parent ? `${f.parent.key} ${f.parent.fields?.summary ?? ""}` : ""],
    ["Labels", (f.labels ?? []).join(", ")],
    ["Components", valueToText(f.components)],
    ["Fix versions", valueToText(f.fixVersions)],
    ["Affects versions", valueToText(f.versions)],
    ["Assignee", people(f.assignee)],
    ["Reporter", people(f.reporter)],
    ["Environment", htmlToMarkdown(r.environment) || valueToText(f.environment)],
  ];
  for (const [k, v] of meta) if (v) lines.push(`- **${k}:** ${v}`);

  const description = htmlToMarkdown(r.description) || adfToText(f.description);
  lines.push("", "## Description", "", description || "_No description._");

  // Custom fields such as Acceptance Criteria, User Story, Business Rules, Figma link, etc.
  const custom: string[] = [];
  for (const [fieldId, raw] of Object.entries(f)) {
    if (!fieldId.startsWith("customfield_") || raw == null) continue;
    const name = names[fieldId] ?? fieldId;
    if (SKIP_FIELD_NAMES.has(name.toLowerCase())) continue;
    const rendered = typeof r[fieldId] === "string" ? htmlToMarkdown(r[fieldId]) : "";
    const text = (rendered || valueToText(raw)).trim();
    if (!text || text === "{}" || text === "[]" || text.length > 20000) continue;
    custom.push(`### ${name}\n\n${text}`);
  }
  if (custom.length) lines.push("", "## Additional fields", "", ...custom);

  const attachments: JiraAttachment[] = (f.attachment ?? []).map((a: any) => ({
    id: String(a.id),
    filename: a.filename,
    mimeType: a.mimeType ?? "",
    size: a.size ?? 0,
    content: a.content,
  }));
  if (attachments.length) {
    lines.push("", "## Attachments", "", ...attachments.map((a) => `- ${a.filename} (${a.mimeType})`));
  }

  const subtaskKeys: string[] = (f.subtasks ?? []).map((s: any) => s.key);
  if (f.subtasks?.length) {
    lines.push("", "## Sub-tasks", "", ...f.subtasks.map((s: any) => `- ${s.key}: ${s.fields?.summary ?? ""} (${s.fields?.status?.name ?? ""})`));
  }

  const linkedKeys: { key: string; relation: string }[] = [];
  for (const l of f.issuelinks ?? []) {
    const other = l.outwardIssue ?? l.inwardIssue;
    if (!other) continue;
    const relation = l.outwardIssue ? l.type?.outward : l.type?.inward;
    linkedKeys.push({ key: other.key, relation: relation ?? "relates to" });
  }
  if (linkedKeys.length) {
    lines.push("", "## Linked issues", "", ...linkedKeys.map((l) => `- ${l.relation} ${l.key}`));
  }

  // Remote links (the "Web links" / Confluence pages panel on the issue).
  let remoteLinks: { url: string; title: string }[] = [];
  try {
    const rl = await atlassianGet<any[]>(`/rest/api/3/issue/${encodeURIComponent(key)}/remotelink`);
    remoteLinks = rl.map((x) => ({ url: x.object?.url ?? "", title: x.object?.title ?? "" })).filter((x) => x.url);
  } catch {
    /* not fatal */
  }
  if (remoteLinks.length) {
    lines.push("", "## Web links", "", ...remoteLinks.map((l) => `- [${l.title || l.url}](${l.url})`));
  }

  if (opts.includeComments) {
    const rendered = r.comment?.comments ?? [];
    const rawComments = f.comment?.comments ?? [];
    if (rawComments.length) {
      lines.push("", "## Comments", "");
      rawComments.forEach((c: any, i: number) => {
        const body = htmlToMarkdown(rendered[i]?.body) || adfToText(c.body);
        lines.push(`**${people(c.author)}** (${(c.created ?? "").slice(0, 10)}):`, "", body.trim(), "");
      });
    }
  }

  const markdown = lines.join("\n");
  const urls = new Set<string>([
    ...extractUrls(JSON.stringify(f)),
    ...extractUrls(JSON.stringify(r)),
    ...remoteLinks.map((l) => l.url),
  ]);

  return { key: issue.key, url, summary: f.summary ?? "", markdown, attachments, subtaskKeys, linkedKeys, urls: [...urls] };
}

/** Issues whose parent is this issue (children of an epic, or sub-tasks in team-managed projects). */
export async function fetchChildKeys(key: string): Promise<string[]> {
  try {
    const res = await atlassianPost<any>("/rest/api/3/search/jql", {
      jql: `parent = ${key} ORDER BY rank ASC`,
      fields: ["summary"],
      maxResults: 100,
    });
    return (res.issues ?? []).map((i: any) => i.key);
  } catch {
    return [];
  }
}
