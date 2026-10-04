import fs from "node:fs/promises";
import { assertAtlassianConfigured, config } from "./config.js";
import { atlassianDownload, isAtlassianUrl } from "./http.js";
import { fetchChildKeys, fetchIssue, type JiraIssueData } from "./jira.js";
import { fetchConfluencePage, resolvePageId } from "./confluence.js";
import { fetchFigma } from "./figma.js";
import { extractUrls, parseConfluenceUrl, parseFigmaUrl, parseJiraKey, type FigmaRef } from "./links.js";
import { looksLikeImage, saveAsPng } from "./images.js";
import { imagesDir, issueWorkDir, saveBundle, type ImageAsset, type SourceBundle, type SourceDoc, type SourceKind } from "./store.js";

export interface CollectOptions {
  includeComments: boolean;
  includeLinkedIssues: boolean;
  maxIssues: number;
  maxConfluencePages: number;
  maxFigmaFrames: number;
}

export async function collectSources(issueInput: string, opts: CollectOptions, log: (msg: string) => void): Promise<SourceBundle> {
  assertAtlassianConfigured();
  const rootKey = parseJiraKey(issueInput);
  if (!rootKey) throw new Error(`"${issueInput}" is not a Jira issue key or browse URL (expected something like KAN-20).`);

  const workDir = issueWorkDir(rootKey);
  await fs.rm(workDir, { recursive: true, force: true });
  const imgDir = imagesDir(rootKey);

  const bundle: SourceBundle = {
    issueKey: rootKey,
    rootTitle: "",
    collectedAt: new Date().toISOString(),
    baseUrl: config.atlassian.baseUrl,
    sources: [],
    images: [],
    skippedLinks: [],
    warnings: [],
  };

  let imgCounter = 0;
  const addImage = async (data: Buffer, src: SourceDoc, originalName: string, label: string): Promise<void> => {
    const id = `img-${String(imgCounter + 1).padStart(2, "0")}`;
    const saved = await saveAsPng(data, imgDir, id);
    if (!saved) return;
    imgCounter++;
    const asset: ImageAsset = { id, ...saved, originalName, sourceId: src.id, sourceTitle: src.title, label };
    bundle.images.push(asset);
    src.imageIds.push(id);
  };

  /* ---------- Jira: root, sub-tasks, child issues, optional linked issues ---------- */
  const seen = new Set<string>();
  const queue: { key: string; kind: SourceKind; depth: number }[] = [{ key: rootKey, kind: "jira-issue", depth: 0 }];
  const allUrls = new Set<string>();
  const otherLinks = new Set<string>();

  while (queue.length && seen.size < opts.maxIssues) {
    const { key, kind, depth } = queue.shift()!;
    if (seen.has(key)) continue;
    seen.add(key);
    log(`Reading Jira issue ${key}`);
    let issue: JiraIssueData;
    try {
      issue = await fetchIssue(key, { includeComments: opts.includeComments });
    } catch (e) {
      if (key === rootKey) throw e;
      bundle.warnings.push(`Could not read ${key}: ${(e as Error).message}`);
      continue;
    }
    if (key === rootKey) bundle.rootTitle = issue.summary;

    const src: SourceDoc = { id: `jira:${issue.key}`, kind, title: `${issue.key} ${issue.summary}`, url: issue.url, text: issue.markdown, imageIds: [] };
    bundle.sources.push(src);
    issue.urls.forEach((u) => allUrls.add(u));
    extractUrls(issue.markdown).forEach((u) => otherLinks.add(u));

    for (const att of issue.attachments) {
      if (!looksLikeImage(att.filename, att.mimeType)) continue;
      try {
        const { data } = await atlassianDownload(att.content);
        await addImage(data, src, att.filename, att.filename.replace(/\.[a-z0-9]+$/i, ""));
      } catch (e) {
        bundle.warnings.push(`Could not download attachment ${att.filename} on ${issue.key}: ${(e as Error).message}`);
      }
    }

    if (depth < 2) {
      for (const k of issue.subtaskKeys) queue.push({ key: k, kind: "jira-subtask", depth: depth + 1 });
      for (const k of await fetchChildKeys(issue.key)) queue.push({ key: k, kind: "jira-child", depth: depth + 1 });
      if (opts.includeLinkedIssues && depth === 0) {
        for (const l of issue.linkedKeys) queue.push({ key: l.key, kind: "jira-linked", depth: 2 });
      }
    }
  }
  if (queue.length) bundle.warnings.push(`Stopped after ${opts.maxIssues} issues; ${queue.length} more were not read.`);

  /* ---------- Classify links ---------- */
  const confluenceUrls: string[] = [];
  const figmaRefs = new Map<string, FigmaRef>();
  const addFigma = (u: string) => {
    const ref = parseFigmaUrl(u);
    if (ref) {
      const k = `${ref.fileKey}|${ref.nodeId ?? ""}`;
      if (!figmaRefs.has(k)) figmaRefs.set(k, ref);
    }
  };
  for (const u of allUrls) {
    if (parseConfluenceUrl(u)) {
      if (isAtlassianUrl(u)) confluenceUrls.push(u);
      else bundle.skippedLinks.push({ url: u, reason: "Confluence page on a different Atlassian site than ATLASSIAN_BASE_URL." });
    } else addFigma(u);
  }

  /* ---------- Confluence ---------- */
  const seenPages = new Set<string>();
  for (const u of confluenceUrls) {
    if (seenPages.size >= opts.maxConfluencePages) {
      bundle.skippedLinks.push({ url: u, reason: `Confluence page limit (${opts.maxConfluencePages}) reached.` });
      continue;
    }
    try {
      const pageId = await resolvePageId(parseConfluenceUrl(u)!);
      if (!pageId) {
        bundle.skippedLinks.push({ url: u, reason: "Could not work out the Confluence page id." });
        continue;
      }
      if (seenPages.has(pageId)) continue;
      seenPages.add(pageId);
      log(`Reading Confluence page ${pageId}`);
      const page = await fetchConfluencePage(pageId);
      const src: SourceDoc = { id: `confluence:${pageId}`, kind: "confluence", title: page.title, url: page.url, text: page.markdown, imageIds: [] };
      bundle.sources.push(src);
      for (const img of page.images) {
        try {
          const { data } = await atlassianDownload(img.downloadPath);
          await addImage(data, src, img.filename, img.filename.replace(/\.[a-z0-9]+$/i, ""));
        } catch (e) {
          bundle.warnings.push(`Could not download ${img.filename} from "${page.title}": ${(e as Error).message}`);
        }
      }
      page.urls.forEach(addFigma); // Figma links inside the spec page
    } catch (e) {
      bundle.skippedLinks.push({ url: u, reason: (e as Error).message });
    }
  }

  /* ---------- Figma ---------- */
  for (const ref of figmaRefs.values()) {
    if (!config.figmaToken) {
      bundle.skippedLinks.push({ url: ref.url, reason: "FIGMA_TOKEN is not set, so the design was not read." });
      continue;
    }
    try {
      log(`Reading Figma file ${ref.fileKey}${ref.nodeId ? ` node ${ref.nodeId}` : ""}`);
      const fig = await fetchFigma(ref, opts.maxFigmaFrames);
      const src: SourceDoc = {
        id: `figma:${ref.fileKey}${ref.nodeId ? ":" + ref.nodeId.replace(":", "-") : ""}`,
        kind: "figma",
        title: fig.fileName,
        url: ref.url,
        text: fig.markdown,
        imageIds: [],
      };
      bundle.sources.push(src);
      for (const fr of fig.frames) if (fr.png) await addImage(fr.png, src, `${fr.name}.png`, `Figma screen: ${fr.name}`);
    } catch (e) {
      bundle.skippedLinks.push({ url: ref.url, reason: (e as Error).message });
    }
  }

  /* ---------- Other links (kept as possible appendix references) ---------- */
  const handled = new Set([...confluenceUrls, ...[...figmaRefs.values()].map((r) => r.url)]);
  const extra = [...otherLinks].filter((u) => !handled.has(u) && !/\/rest\/api\/|\/secure\/|avatar|\/browse\//i.test(u));
  if (extra.length) {
    bundle.sources[0].text += `\n\n## Other links found in Jira\n\n${extra.map((u) => `- ${u}`).join("\n")}`;
  }

  await saveBundle(bundle);
  return bundle;
}
