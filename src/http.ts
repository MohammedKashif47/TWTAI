import { config } from "./config.js";

export class HttpError extends Error {
  constructor(
    public status: number,
    public url: string,
    body: string,
  ) {
    super(`HTTP ${status} for ${url}: ${body.slice(0, 400)}`);
  }
}

function atlassianAuthHeader(): string {
  const { email, token } = config.atlassian;
  return "Basic " + Buffer.from(`${email}:${token}`).toString("base64");
}

/** True when the URL points at the configured Atlassian site. */
export function isAtlassianUrl(url: string): boolean {
  try {
    return new URL(url).host === new URL(config.atlassian.baseUrl).host;
  } catch {
    return false;
  }
}

async function request(url: string, headers: Record<string, string>, attempt = 0): Promise<Response> {
  const res = await fetch(url, { headers, redirect: "follow" });
  // Respect rate limiting from Atlassian and Figma.
  if (res.status === 429 && attempt < 4) {
    const retryAfter = Number(res.headers.get("retry-after")) || 2 ** attempt * 2;
    await new Promise((r) => setTimeout(r, Math.min(retryAfter, 30) * 1000));
    return request(url, headers, attempt + 1);
  }
  return res;
}

export async function atlassianGet<T = unknown>(pathOrUrl: string): Promise<T> {
  const url = pathOrUrl.startsWith("http") ? pathOrUrl : config.atlassian.baseUrl + pathOrUrl;
  const res = await request(url, { Authorization: atlassianAuthHeader(), Accept: "application/json" });
  if (!res.ok) throw new HttpError(res.status, url, await res.text());
  return (await res.json()) as T;
}

export async function atlassianPost<T = unknown>(path: string, body: unknown): Promise<T> {
  const url = config.atlassian.baseUrl + path;
  const res = await fetch(url, {
    method: "POST",
    headers: { Authorization: atlassianAuthHeader(), Accept: "application/json", "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new HttpError(res.status, url, await res.text());
  return (await res.json()) as T;
}

/** Downloads binary content from Atlassian (attachments). Returns the bytes and the final URL after redirects. */
export async function atlassianDownload(pathOrUrl: string): Promise<{ data: Buffer; finalUrl: string; contentType: string }> {
  const url = pathOrUrl.startsWith("http") ? pathOrUrl : config.atlassian.baseUrl + pathOrUrl;
  const res = await request(url, { Authorization: atlassianAuthHeader() });
  if (!res.ok) throw new HttpError(res.status, url, await res.text());
  return {
    data: Buffer.from(await res.arrayBuffer()),
    finalUrl: res.url,
    contentType: res.headers.get("content-type") ?? "",
  };
}

/** Resolves a URL (for example a Confluence tiny link) to its final location. */
export async function atlassianResolve(url: string): Promise<string> {
  const res = await request(url, { Authorization: atlassianAuthHeader(), Accept: "text/html" });
  return res.url || url;
}

export async function figmaGet<T = unknown>(path: string): Promise<T> {
  const url = "https://api.figma.com" + path;
  const res = await request(url, { "X-Figma-Token": config.figmaToken });
  if (!res.ok) throw new HttpError(res.status, url, await res.text());
  return (await res.json()) as T;
}

export async function plainDownload(url: string): Promise<Buffer> {
  const res = await request(url, {});
  if (!res.ok) throw new HttpError(res.status, url, await res.text());
  return Buffer.from(await res.arrayBuffer());
}
