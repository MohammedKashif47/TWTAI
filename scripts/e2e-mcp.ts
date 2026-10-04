/**
 * End-to-end test of the default MCP mode. It plays the part of Claude: the Jira, Confluence and Figma
 * content is assumed to have been read through the Atlassian and Figma MCP servers, and only the
 * session, image and build tools of this server are called.
 */
import fs from "node:fs/promises";
import path from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { screen, startMock } from "./mock-atlassian.js";
import { SOURCE_TEXT, sampleSpec } from "./sample-spec.js";

const root = path.resolve(import.meta.dirname, "..");
await fs.rm(path.join(root, "test-output", "workspace-mcp"), { recursive: true, force: true });
await fs.rm(path.join(root, "test-output", "guides-mcp"), { recursive: true, force: true });
await fs.mkdir(path.join(root, "test-output"), { recursive: true });
const mock = await startMock();
const env = { ...(process.env as Record<string, string>) };
for (const k of ["ATLASSIAN_BASE_URL", "ATLASSIAN_EMAIL", "ATLASSIAN_API_TOKEN", "GATHER_MODE"]) delete env[k];
const transport = new StdioClientTransport({
  command: process.execPath,
  args: [path.join(root, "node_modules/tsx/dist/cli.mjs"), path.join(root, "src/index.ts")],
  env: { ...env, ATLASSIAN_API_TOKEN: "", GATHER_MODE: "mcp", ALLOWED_MCP_CLIENTS: "*", SUPPORT_EMAIL: "support@acme.example", WORK_DIR: path.join(root, "test-output", "workspace-mcp"), OUTPUT_DIR: path.join(root, "test-output", "guides-mcp") },
  stderr: "inherit",
});
const client = new Client({ name: "e2e-mcp", version: "1.0.0" });
await client.connect(transport);
const call = async (name: string, args: Record<string, unknown>) => {
  const r: any = await client.callTool({ name, arguments: args });
  const t = r.content.filter((c: any) => c.type === "text").map((c: any) => c.text).join("\n");
  return { error: !!r.isError, text: t, types: r.content.map((c: any) => c.type) };
};
const check = (ok: boolean, msg: string) => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${msg}`);
  if (!ok) process.exitCode = 1;
};

const tools = (await client.listTools()).tools.map((t) => t.name);
console.log("TOOLS:", tools.join(", "));
check(!tools.includes("collect_guide_sources"), "token-only tools are hidden in MCP mode");

const started = JSON.parse((await call("start_guide", { issue: "https://kashiftwtai.atlassian.net/browse/KAN-20", summary: "Order export for portal users" })).text);
check(started.issueKey === "KAN-20" && started.writingRules.includes("getJiraIssue"), "start_guide returns inbox and MCP gathering rules");

for (const s of [
  { id: "jira:KAN-20", kind: "jira-issue", title: "Order export for portal users", url: "https://kashiftwtai.atlassian.net/browse/KAN-20" },
  { id: "jira:KAN-21", kind: "jira-subtask", title: "Export dialog", url: "https://kashiftwtai.atlassian.net/browse/KAN-21" },
  { id: "confluence:555", kind: "confluence", title: "Order Export Spec", url: "https://kashiftwtai.atlassian.net/wiki/spaces/AP/pages/555" },
  { id: "figma:AbCdEfGhIjKlMnOpQrStUv", kind: "figma", title: "Portal designs", url: "https://www.figma.com/design/AbCdEfGhIjKlMnOpQrStUv/Portal" },
]) {
  const content = (SOURCE_TEXT as Record<string, string>)[s.id] ?? "Screen: Export orders\n- Format\n- Date range\n- Export";
  await call("register_source", { issueKey: "KAN-20", ...s, notes: "test", content });
}

// Jira screenshots the user saved into the inbox
await fs.writeFile(path.join(started.inboxFolder, "home.png"), await screen("Home", ["Recent orders", "Notifications"]));
await fs.writeFile(path.join(started.inboxFolder, "orders-page.png"), await screen("Orders", ["Search orders", "Export", "Order #1001 - Pending"]));
await fs.writeFile(path.join(started.inboxFolder, "readme.txt"), "not an image");
const imp = JSON.parse((await call("import_images", { issueKey: "KAN-20", sourceId: "jira:KAN-20" })).text);
check(imp.imported.length === 2, `import_images imported ${imp.imported.length} images from the inbox`);
const again = JSON.parse((await call("import_images", { issueKey: "KAN-20", sourceId: "jira:KAN-20" })).text);
check(again.imported.length === 0, "re-importing skips files already imported");

// A Figma MCP get_screenshot URL
const fig = await call("add_image", { issueKey: "KAN-20", url: `${mock.url}/public/figma-export-dialog.png`, label: "Figma screen: Export orders", sourceId: "figma:AbCdEfGhIjKlMnOpQrStUv" });
check(!fig.error && JSON.parse(fig.text).imageId === "img-03", "add_image downloads a Figma export URL");

// A local file
const local = path.join(root, "test-output", "flow.png");
await fs.writeFile(local, await screen("Spec diagram", ["Export flow"]));
const loc = await call("add_image", { issueKey: "KAN-20", path: local, label: "Export flow diagram", sourceId: "confluence:555" });
check(!loc.error && JSON.parse(loc.text).imageId === "img-04", "add_image copies a local file");

// A Jira attachment URL without a token must fail with guidance
const att = await call("add_image", { issueKey: "KAN-20", url: "https://kashiftwtai.atlassian.net/rest/api/3/attachment/content/10001", label: "x", sourceId: "jira:KAN-20" });
check(att.error && att.text.includes("inbox"), "Jira attachment URL without a token explains the inbox route");

const view = await call("view_image", { issueKey: "KAN-20", imageId: "img-03" });
check(view.types.includes("image"), "view_image returns the picture");
const screenText: Record<string, string> = {
  "img-01": "Acme Portal\nHome\nOrders\nSettings\nRecent orders\nNotifications",
  "img-02": "Acme Portal\nOrders\nSearch orders\nExport\nOrder #1001 - Pending",
  "img-03": "Export orders\nFormat: CSV | XLSX\nDate range\nExport",
  "img-04": "Spec diagram\nExport flow",
};
for (const [imageId, text] of Object.entries(screenText)) await call("record_image_text", { issueKey: "KAN-20", imageId, text });

// Out-of-scope content must be rejected
const bad: any = sampleSpec("");
bad.features[0].procedures.push({
  title: "Installing Acme Portal",
  steps: [{ text: "Run the installer from the Start Menu." }],
  evidence: [{ sourceId: "jira:KAN-20", quote: "Acme Portal can be installed on Windows and macOS." }],
});
bad.features[0].details.push({ heading: "Configuring initial settings", paragraphs: ["Works seamlessly on mobile, tablet and desktop browsers."] });
bad.appendix.glossary.push({ term: "Single sign-on", definition: "x" });
bad.appendix.contacts.push({ role: "Sales", phone: "9999999999" });
const rejected = JSON.parse((await call("build_user_guide", { issueKey: "KAN-20", spec: bad })).text);
const errs = rejected.errors.join("\n");
console.log("REJECTED ERRORS:\n- " + rejected.errors.join("\n- "));
check(rejected.built === false, "out-of-scope spec is not built");
check(/Installing Acme Portal/.test(errs) && /install/.test(errs), "invented installation procedure is rejected");
check(/none of the evidence quotes were found/.test(errs), "fabricated evidence quote is rejected");
check(/Configuring initial settings/.test(errs), "invented settings section is rejected");
check(/Single sign-on/.test(errs), "invented glossary term is rejected");
check(/9999999999/.test(errs), "invented phone number is rejected");
check(rejected.warnings.some((w: string) => /seamless/.test(w)), "filler words are flagged");

// A guide that leaves source content out must get a coverage report that names it
const thin: any = sampleSpec("");
thin.features[0].details = thin.features[0].details.filter((d: any) => d.heading !== "Export limits");
thin.appendix.troubleshooting = [];
const thinRes = JSON.parse((await call("build_user_guide", { issueKey: "KAN-20", spec: thin, dryRun: true })).text);
check(
  thinRes.dryRun && thinRes.coverage.uncovered.some((u: any) => /Narrow your filter/.test(u.fact)),
  `dry run reports uncovered source statements (${thinRes.coverage.percent}%): ${thinRes.coverage.uncovered.map((u: any) => u.fact).join(" | ")}`,
);

const spec: any = sampleSpec("");
spec.appendix.references = [];
const built = await call("build_user_guide", { issueKey: "KAN-20", spec });
console.log(built.text);
const res = JSON.parse(built.text);
check(res.built && res.figures === 4 && res.excludedImages.length === 0, "guide built with all 4 images");
check(typeof res.coverage?.percent === "number", `coverage reported: ${res.coverage?.percent}% (${res.coverage?.covered}/${res.coverage?.total})`);
console.log("UNCOVERED:", res.coverage.uncovered);

// A screenshot saved to the inbox later is imported by the build, which then refuses to finish until it is placed
await fs.writeFile(path.join(started.inboxFolder, "settings-panel.png"), await screen("Settings", ["Language", "Theme"]));
const late = JSON.parse((await call("build_user_guide", { issueKey: "KAN-20", spec, dryRun: true })).text);
check(late.newImagesFromInbox?.some((x: string) => /settings-panel/.test(x)), "build imports a screenshot added to the inbox later");
check(late.built === false && late.errors.some((e: string) => /not in the guide/.test(e) && /img-05/.test(e)), "build refuses while a collected screenshot is not placed");
spec.excludedImages = [{ imageId: "img-05", reason: "Shows the settings panel, which is not part of this feature." }];
const ok = JSON.parse((await call("build_user_guide", { issueKey: "KAN-20", spec, dryRun: true })).text);
check(ok.ok === true, "an image excluded with a reason is accepted");

// Starting a fresh session imports everything already waiting in the inbox
const fresh = JSON.parse((await call("start_guide", { issue: "KAN-20" })).text);
check(fresh.importedFromInbox.length === 3, `start_guide imports inbox screenshots (${fresh.importedFromInbox.join(", ")})`);

await client.close();

// A script that starts the server itself (no override) is refused
const scripted = new Client({ name: "guide-builder", version: "1.0.0" });
await scripted.connect(
  new StdioClientTransport({
    command: process.execPath,
    args: [path.join(root, "node_modules/tsx/dist/cli.mjs"), path.join(root, "src/index.ts")],
    env: { ...env, GATHER_MODE: "mcp", WORK_DIR: path.join(root, "test-output", "workspace-scripted") },
    stderr: "ignore",
  }),
);
const sr: any = await scripted.callTool({ name: "start_guide", arguments: { issue: "KAN-20" } });
check(sr.isError && /looks like a script/.test(sr.content[0].text), "a scripted client is refused");
await scripted.close();
const claudeLike = new Client({ name: "claude-code", version: "2.0.0" });
await claudeLike.connect(
  new StdioClientTransport({
    command: process.execPath,
    args: [path.join(root, "node_modules/tsx/dist/cli.mjs"), path.join(root, "src/index.ts")],
    env: { ...env, GATHER_MODE: "mcp", WORK_DIR: path.join(root, "test-output", "workspace-scripted") },
    stderr: "ignore",
  }),
);
const cr: any = await claudeLike.callTool({ name: "start_guide", arguments: { issue: "KAN-20" } });
check(!cr.isError, "Claude Code is accepted");
await claudeLike.close();
mock.close();
