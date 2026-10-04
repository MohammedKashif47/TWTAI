import { atlassianGet, atlassianResolve } from "./http.js";
import { htmlToMarkdown } from "./html.js";
import { extractUrls, parseConfluenceUrl, type ConfluenceRef } from "./links.js";
import { looksLikeImage } from "./images.js";
import { config } from "./config.js";

/* eslint-disable @typescript-eslint/no-explicit-any */

export interface ConfluencePageData {
  pageId: string;
  title: string;
  url: string;
  markdown: string;
  images: { id: string; filename: string; downloadPath: string }[];
  urls: string[];
}

export async function resolvePageId(ref: ConfluenceRef): Promise<string | null> {
  if (ref.pageId) return ref.pageId;
  if (ref.tinyUrl) {
    const final = await atlassianResolve(ref.url);
    return parseConfluenceUrl(final)?.pageId ?? null;
  }
  return null;
}

export async function fetchConfluencePage(pageId: string): Promise<ConfluencePageData> {
  const page = await atlassianGet<any>(`/wiki/api/v2/pages/${pageId}?body-format=storage`);
  const storage: string = page.body?.storage?.value ?? "";
  const base = page._links?.base ?? "";
  const url = base && page._links?.webui ? base + page._links.webui : `${config.atlassian.baseUrl}/wiki/pages/viewpage.action?pageId=${pageId}`;

  const atts: any[] = [];
  let next: string | null = `/wiki/api/v2/pages/${pageId}/attachments?limit=100`;
  while (next && atts.length < 300) {
    const res: any = await atlassianGet<any>(next);
    atts.push(...(res.results ?? []));
    next = res._links?.next ?? null;
  }

  // Prefer images the page actually shows; fall back to every image attachment.
  const referenced = new Set([...storage.matchAll(/ri:filename="([^"]+)"/g)].map((m) => m[1]));
  const imageAtts = atts.filter((a) => looksLikeImage(a.title ?? "", a.mediaType));
  const chosen = referenced.size ? imageAtts.filter((a) => referenced.has(a.title)) : imageAtts;

  const images = chosen.map((a) => ({
    id: String(a.id),
    filename: a.title,
    downloadPath: "/wiki" + (a.downloadLink ?? `/download/attachments/${pageId}/${encodeURIComponent(a.title)}`),
  }));

  // Image macros have no text, so turn them into visible placeholders before conversion.
  const prepared = storage.replace(/<ac:image[^>]*>[\s\S]*?<\/ac:image>/g, (m) => {
    const name = m.match(/ri:filename="([^"]+)"/)?.[1];
    return `<p>(Image: ${name ?? "embedded image"})</p>`;
  });
  const markdown = [`# ${page.title}`, "", htmlToMarkdown(prepared)].join("\n");
  return { pageId, title: page.title, url, markdown, images, urls: extractUrls(storage) };
}
