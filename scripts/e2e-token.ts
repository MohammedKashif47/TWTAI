/**
 * End-to-end test of token mode (GATHER_MODE=token) against a fake Atlassian site.
 * Starts the MCP server over stdio, runs the full tool workflow, and writes a sample guide to ./output.
 */
import path from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { startMock } from "./mock-atlassian.js";
import { sampleSpec } from "./sample-spec.js";

const root = path.resolve(import.meta.dirname, "..");

const mock = await startMock();
const transport = new StdioClientTransport({
  command: process.execPath,
  args: [path.join(root, "node_modules/tsx/dist/cli.mjs"), path.join(root, "src/index.ts")],
  env: {
    ...(process.env as Record<string, string>),
    GATHER_MODE: "token",
    ALLOWED_MCP_CLIENTS: "*",
    SUPPORT_EMAIL: "support@acme.example",
    ATLASSIAN_BASE_URL: mock.url,
    ATLASSIAN_EMAIL: "test@example.com",
    ATLASSIAN_API_TOKEN: "x",
    FIGMA_TOKEN: "",
    WORK_DIR: path.join(root, "test-output", "workspace-token"),
    OUTPUT_DIR: path.join(root, "test-output", "guides"),
  },
  stderr: "inherit",
});
const client = new Client({ name: "e2e", version: "1.0.0" });
await client.connect(transport);

const text = (r: any) => r.content.filter((c: any) => c.type === "text").map((c: any) => c.text).join("\n");

console.log("TOOLS:", (await client.listTools()).tools.map((t) => t.name).join(", "));
console.log("PROMPTS:", (await client.listPrompts()).prompts.map((p) => p.name).join(", "));

const collected = JSON.parse(text(await client.callTool({ name: "collect_guide_sources", arguments: { issue: `${mock.url}/browse/KAN-20` } })));
console.log("SOURCES:", collected.sources.map((s: any) => `${s.id} [${s.imageIds}]`));
console.log("IMAGES:", collected.images);
console.log("SKIPPED:", collected.skippedLinks);
console.log("WARNINGS:", collected.warnings);

for (const s of collected.sources) {
  const r = await client.callTool({ name: "read_source", arguments: { issueKey: "KAN-20", sourceId: s.id } });
  console.log("\n=====", s.id, "\n" + text(r).slice(0, 1500));
}
const img = await client.callTool({ name: "view_image", arguments: { issueKey: "KAN-20", imageId: "img-01" } });
console.log("VIEW_IMAGE:", (img.content as any[]).map((c) => c.type));

const spec = sampleSpec(`${mock.url}/wiki/spaces/AP/pages/555`);

// 1) A deliberately bad title must be rejected.
const bad = await client.callTool({ name: "build_user_guide", arguments: { issueKey: "KAN-20", spec: { ...spec, title: "KAN-20 User Guide" } } });
console.log("\nBAD TITLE RESULT:", text(bad).slice(0, 300));

// 2) The real build.
const built = await client.callTool({ name: "build_user_guide", arguments: { issueKey: "KAN-20", spec } });
console.log("\nBUILD RESULT:", text(built));

await client.close();
mock.close();
