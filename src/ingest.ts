import fs from "node:fs/promises";
import path from "node:path";
import { config } from "./config.js";
import { atlassianDownload, isAtlassianUrl, plainDownload } from "./http.js";
import { looksLikeImage, saveAsPng } from "./images.js";
import { imagesDir, inboxDir, nextImageId, saveBundle, type ImageAsset, type SourceBundle } from "./store.js";

export interface AddImageInput {
  url?: string;
  path?: string;
  label: string;
  sourceId: string;
  originalName?: string;
}

/** Reads image bytes from a local file or a URL (Figma MCP export URLs, public URLs, or Atlassian URLs when a token is set). */
async function readImageBytes(input: AddImageInput): Promise<Buffer> {
  if (input.path) return fs.readFile(path.resolve(input.path));
  if (!input.url) throw new Error("Provide either url or path.");
  if (isAtlassianUrl(input.url) || /\.atlassian\.net\//.test(input.url)) {
    if (!config.atlassian.token) {
      throw new Error(
        "Jira and Confluence attachment links need a signed-in download, which the Atlassian MCP does not provide. " +
          "Save the screenshot into the session's inbox folder and run import_images, or set ATLASSIAN_API_TOKEN in .env so the server can download attachments.",
      );
    }
    return (await atlassianDownload(input.url)).data;
  }
  return plainDownload(input.url);
}

export async function addImage(bundle: SourceBundle, input: AddImageInput): Promise<ImageAsset> {
  const data = await readImageBytes(input);
  const id = nextImageId(bundle);
  const saved = await saveAsPng(data, imagesDir(bundle.issueKey), id);
  if (!saved) throw new Error("The file is not an image, or it is smaller than 48 px.");
  const source = bundle.sources.find((s) => s.id === input.sourceId);
  const asset: ImageAsset = {
    id,
    ...saved,
    originalName: input.originalName ?? (input.path ? path.basename(input.path) : decodeURIComponent(new URL(input.url!).pathname.split("/").pop() || id)),
    sourceId: input.sourceId,
    sourceTitle: source?.title ?? input.sourceId,
    label: input.label,
  };
  bundle.images.push(asset);
  source?.imageIds.push(id);
  await saveBundle(bundle);
  return asset;
}

/** Imports every image in a folder (default: the session inbox). File names become labels. */
export async function importFolder(bundle: SourceBundle, folder: string | undefined, sourceId: string): Promise<{ added: ImageAsset[]; skipped: string[] }> {
  const dir = path.resolve(folder || inboxDir(bundle.issueKey));
  const already = new Set(bundle.images.map((i) => i.originalName));
  const entries = (await fs.readdir(dir, { withFileTypes: true })).filter((e) => e.isFile() && looksLikeImage(e.name)).map((e) => e.name).sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
  const added: ImageAsset[] = [];
  const skipped: string[] = [];
  for (const name of entries) {
    if (already.has(name)) {
      skipped.push(`${name} (already imported)`);
      continue;
    }
    try {
      added.push(await addImage(bundle, { path: path.join(dir, name), label: name.replace(/\.[a-z0-9]+$/i, "").replace(/[-_]+/g, " "), sourceId, originalName: name }));
    } catch (e) {
      skipped.push(`${name} (${(e as Error).message})`);
    }
  }
  return { added, skipped };
}
