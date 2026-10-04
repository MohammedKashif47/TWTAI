import { config } from "./config.js";

/** URL discovery and classification for Jira, Confluence and Figma links. */

const URL_RE = /https?:\/\/[^\s"'<>\]\)\\|]+/g;

export function extractUrls(text: string): string[] {
  const found = new Set<string>();
  for (const m of text.matchAll(URL_RE)) {
    found.add(m[0].replace(/[.,;:!?]+$/, "").replace(/&amp;/g, "&"));
  }
  return [...found];
}

/**
 * Finds the Jira issue key in what the user typed: a key (KAN-20, kan-20), a browse or board URL,
 * a phrase that contains a key ("create the user guide for KAN-20"), or a bare number ("20")
 * when JIRA_PROJECT_KEY is set.
 */
export function parseJiraKey(input: string, defaultProject = config.defaultProjectKey): string | null {
  const s = input.trim();
  const fromUrl = s.match(/\/browse\/([A-Z][A-Z0-9_]+-\d+)/i) ?? s.match(/[?&]selectedIssue=([A-Z][A-Z0-9_]+-\d+)/i);
  if (fromUrl) return fromUrl[1].toUpperCase();
  const key = s.match(/\b([A-Z][A-Z0-9_]+-\d+)\b/i);
  if (key) return key[1].toUpperCase();
  const num = s.match(/^#?(\d+)$/) ?? s.match(/\b(?:issue|jira|ticket|story|number|no\.?|for)\s*#?(\d+)\b/i);
  if (num && defaultProject) return `${defaultProject.toUpperCase()}-${num[1]}`;
  return null;
}

export type ConfluenceRef = { url: string; pageId?: string; tinyUrl?: boolean };

export function parseConfluenceUrl(url: string): ConfluenceRef | null {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return null;
  }
  if (!u.pathname.startsWith("/wiki")) return null;
  const byPath = u.pathname.match(/\/pages\/(?:edit-v2\/|edit\/)?(\d+)/);
  if (byPath) return { url, pageId: byPath[1] };
  const byQuery = u.searchParams.get("pageId");
  if (byQuery) return { url, pageId: byQuery };
  if (/^\/wiki\/x\//.test(u.pathname)) return { url, tinyUrl: true };
  return null;
}

export type FigmaRef = { url: string; fileKey: string; nodeId?: string; kind: "design" | "board" | "proto" | "make" | "slides" };

export function parseFigmaUrl(url: string): FigmaRef | null {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return null;
  }
  if (!/(^|\.)figma\.com$/.test(u.hostname)) return null;
  const parts = u.pathname.split("/").filter(Boolean);
  const kindRaw = parts[0];
  if (!kindRaw || !parts[1]) return null;
  const kind = (kindRaw === "file" ? "design" : kindRaw) as FigmaRef["kind"];
  if (!["design", "board", "proto", "make", "slides"].includes(kind)) return null;
  // Branch URLs: /design/:fileKey/branch/:branchKey/:name
  const fileKey = parts[2] === "branch" && parts[3] ? parts[3] : parts[1];
  const rawNode = u.searchParams.get("node-id") ?? u.searchParams.get("starting-point-node-id");
  const nodeId = rawNode ? decodeURIComponent(rawNode).replace(/-/g, ":") : undefined;
  return { url, fileKey, nodeId, kind };
}
