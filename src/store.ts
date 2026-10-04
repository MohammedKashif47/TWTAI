import fs from "node:fs/promises";
import path from "node:path";
import { config } from "./config.js";

export type SourceKind = "jira-issue" | "jira-subtask" | "jira-child" | "jira-linked" | "confluence" | "figma" | "other";

export interface SourceDoc {
  /** Short stable id used by read_source, e.g. "jira:KAN-20" or "confluence:12345". */
  id: string;
  kind: SourceKind;
  title: string;
  url: string;
  /** Full markdown text, when the server fetched it itself (token mode). Empty when Claude read it through another MCP. */
  text: string;
  /** Short note on what this source contributed (MCP mode). */
  notes?: string;
  /** Image ids that came from this source. */
  imageIds: string[];
}

export interface ImageAsset {
  id: string;
  /** Absolute path of the normalized PNG on disk. */
  file: string;
  width: number;
  height: number;
  originalName: string;
  sourceId: string;
  sourceTitle: string;
  /** What the image is, as far as the source says (attachment name, Figma frame name, ...). */
  label: string;
  /** Text Claude read off the image with record_image_text (labels, headings, messages). */
  visibleText?: string;
}

export interface SourceBundle {
  issueKey: string;
  rootTitle: string;
  collectedAt: string;
  baseUrl: string;
  sources: SourceDoc[];
  images: ImageAsset[];
  /** Links that were found but could not be read, with the reason. */
  skippedLinks: { url: string; reason: string }[];
  /** Non-fatal problems during collection. */
  warnings: string[];
}

export function issueWorkDir(issueKey: string): string {
  return path.join(config.workDir, issueKey);
}

export function inboxDir(issueKey: string): string {
  return path.join(issueWorkDir(issueKey), "inbox");
}

export function imagesDir(issueKey: string): string {
  return path.join(issueWorkDir(issueKey), "images");
}

const cache = new Map<string, SourceBundle>();

export async function saveBundle(bundle: SourceBundle): Promise<string> {
  const dir = issueWorkDir(bundle.issueKey);
  await fs.mkdir(dir, { recursive: true });
  const file = path.join(dir, "sources.json");
  await fs.writeFile(file, JSON.stringify(bundle, null, 2), "utf8");
  cache.set(bundle.issueKey, bundle);
  return file;
}

export function emptyBundle(issueKey: string, rootTitle = ""): SourceBundle {
  return {
    issueKey,
    rootTitle,
    collectedAt: new Date().toISOString(),
    baseUrl: config.atlassian.baseUrl,
    sources: [],
    images: [],
    skippedLinks: [],
    warnings: [],
  };
}

export function nextImageId(bundle: SourceBundle): string {
  const max = bundle.images.reduce((m, i) => Math.max(m, Number(i.id.replace(/\D/g, "")) || 0), 0);
  return `img-${String(max + 1).padStart(2, "0")}`;
}

export async function loadBundle(issueKey: string): Promise<SourceBundle> {
  const key = issueKey.toUpperCase();
  const hit = cache.get(key);
  if (hit) return hit;
  const file = path.join(issueWorkDir(key), "sources.json");
  try {
    const bundle = JSON.parse(await fs.readFile(file, "utf8")) as SourceBundle;
    cache.set(key, bundle);
    return bundle;
  } catch {
    throw new Error(`No collected sources found for ${key}. Call start_guide for this issue first.`);
  }
}
