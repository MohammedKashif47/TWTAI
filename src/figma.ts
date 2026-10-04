import { figmaGet, plainDownload } from "./http.js";
import type { FigmaRef } from "./links.js";

/* eslint-disable @typescript-eslint/no-explicit-any */

export interface FigmaFrameData {
  nodeId: string;
  name: string;
  png?: Buffer;
}

export interface FigmaData {
  fileKey: string;
  fileName: string;
  url: string;
  markdown: string;
  frames: FigmaFrameData[];
}

const FRAME_TYPES = new Set(["FRAME", "COMPONENT", "COMPONENT_SET", "INSTANCE"]);
const CONTAINER_TYPES = new Set(["CANVAS", "SECTION", "GROUP", "DOCUMENT"]);

function collectFrames(node: any, out: any[], max: number): void {
  if (!node || out.length >= max) return;
  if (FRAME_TYPES.has(node.type)) {
    out.push(node);
    return;
  }
  if (CONTAINER_TYPES.has(node.type)) {
    for (const c of node.children ?? []) collectFrames(c, out, max);
  }
}

interface Outline {
  lines: string[];
  interactions: string[];
}

function walk(node: any, depth: number, o: Outline, names: Map<string, string>, budget: { n: number }): void {
  if (!node || budget.n <= 0 || node.visible === false) return;
  budget.n--;
  const indent = "  ".repeat(Math.min(depth, 6));
  if (node.type === "TEXT" && node.characters?.trim()) {
    o.lines.push(`${indent}- "${node.characters.trim().replace(/\s+/g, " ")}"`);
  } else if (depth > 0 && (FRAME_TYPES.has(node.type) || node.type === "GROUP") && node.name && !/^(Frame|Group|Rectangle|Vector)\s*\d*$/i.test(node.name)) {
    o.lines.push(`${indent}- [${node.type.toLowerCase()}] ${node.name}`);
  }
  for (const r of node.interactions ?? []) {
    for (const a of r.actions ?? []) {
      if (a?.destinationId) {
        const trig = r.trigger?.type?.toLowerCase().replace(/_/g, " ") ?? "interaction";
        o.interactions.push(`- ${trig} on "${node.name}" -> navigates to "${names.get(a.destinationId) ?? a.destinationId}"`);
      }
    }
  }
  if (node.transitionNodeID) {
    o.interactions.push(`- on click "${node.name}" -> navigates to "${names.get(node.transitionNodeID) ?? node.transitionNodeID}"`);
  }
  for (const c of node.children ?? []) walk(c, depth + 1, o, names, budget);
}

export async function fetchFigma(ref: FigmaRef, maxFrames: number): Promise<FigmaData> {
  if (ref.kind === "make") throw new Error("Figma Make files cannot be read through the Figma REST API.");

  // Structure: top-level pages and their direct frames, for names and for picking frames.
  const file = await figmaGet<any>(`/v1/files/${ref.fileKey}?depth=2`);
  const names = new Map<string, string>();
  for (const page of file.document?.children ?? []) {
    names.set(page.id, page.name);
    for (const f of page.children ?? []) names.set(f.id, f.name);
  }

  let frameNodes: any[] = [];
  if (ref.nodeId) {
    const res = await figmaGet<any>(`/v1/files/${ref.fileKey}/nodes?ids=${encodeURIComponent(ref.nodeId)}`);
    const doc = res.nodes?.[ref.nodeId]?.document;
    if (!doc) throw new Error(`Node ${ref.nodeId} not found in Figma file ${ref.fileKey}.`);
    collectFrames(doc, frameNodes, maxFrames);
    // A single frame with nested screens: keep the frame itself.
    if (!frameNodes.length) frameNodes = [doc];
  } else {
    const firstPages = (file.document?.children ?? []).slice(0, 3);
    const ids: string[] = [];
    for (const p of firstPages) for (const f of p.children ?? []) if (FRAME_TYPES.has(f.type) || f.type === "SECTION") ids.push(f.id);
    if (ids.length) {
      const res = await figmaGet<any>(`/v1/files/${ref.fileKey}/nodes?ids=${encodeURIComponent(ids.slice(0, maxFrames * 2).join(","))}`);
      for (const id of ids) collectFrames(res.nodes?.[id]?.document, frameNodes, maxFrames);
    }
  }
  frameNodes = frameNodes.slice(0, maxFrames);
  for (const n of frameNodes) names.set(n.id, n.name);

  const md: string[] = [`# Figma design: ${file.name}`, "", `File key: ${ref.fileKey}`, `Pages: ${(file.document?.children ?? []).map((p: any) => p.name).join(", ")}`];
  const flows = (file.document?.children ?? []).flatMap((p: any) => p.flowStartingPoints ?? []);
  if (flows.length) md.push(`Prototype flows: ${flows.map((f: any) => `${f.name} (starts at "${names.get(f.nodeId) ?? f.nodeId}")`).join("; ")}`);

  for (const n of frameNodes) {
    const o: Outline = { lines: [], interactions: [] };
    walk(n, 0, o, names, { n: 1500 });
    md.push("", `## Screen: ${n.name}`, `Figma node: ${n.id}`, "", "Visible text and named elements:", ...(o.lines.length ? o.lines : ["- (no text)"]));
    if (o.interactions.length) md.push("", "Prototype navigation:", ...o.interactions);
  }

  const frames: FigmaFrameData[] = frameNodes.map((n) => ({ nodeId: n.id, name: n.name }));
  if (frames.length) {
    const ids = frames.map((f) => f.nodeId).join(",");
    const img = await figmaGet<any>(`/v1/images/${ref.fileKey}?ids=${encodeURIComponent(ids)}&format=png&scale=2`);
    await Promise.all(
      frames.map(async (f) => {
        const u = img.images?.[f.nodeId];
        if (u) {
          try {
            f.png = await plainDownload(u);
          } catch {
            /* rendered image missing; keep text */
          }
        }
      }),
    );
  }

  return { fileKey: ref.fileKey, fileName: file.name, url: ref.url, markdown: md.join("\n"), frames };
}
