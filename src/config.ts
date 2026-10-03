import path from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";

const here = path.dirname(fileURLToPath(import.meta.url));
export const PROJECT_ROOT = path.resolve(here, "..");

// Load .env from the project root no matter which directory the client launches us from.
dotenv.config({ path: path.join(PROJECT_ROOT, ".env"), quiet: true } as dotenv.DotenvConfigOptions);

function env(name: string, fallback = ""): string {
  const v = process.env[name];
  return v && v.trim() ? v.trim() : fallback;
}

export const config = {
  atlassian: {
    baseUrl: env("ATLASSIAN_BASE_URL", env("JIRA_BASE_URL")).replace(/\/+$/, ""),
    email: env("ATLASSIAN_EMAIL", env("JIRA_EMAIL")),
    token: env("ATLASSIAN_API_TOKEN", env("JIRA_API_TOKEN")),
  },
  figmaToken: env("FIGMA_TOKEN"),
  /** Project key used when only an issue number is given ("create the user guide for 20" -> KAN-20). */
  defaultProjectKey: env("JIRA_PROJECT_KEY"),
  /** "mcp": Claude reads Jira/Confluence/Figma through their MCP servers (default). "token": this server reads them with API tokens. */
  gatherMode: (env("GATHER_MODE", "mcp").toLowerCase() === "token" ? "token" : "mcp") as "mcp" | "token",
  workDir: path.resolve(env("WORK_DIR", path.join(PROJECT_ROOT, "workspace"))),
  outputDir: path.resolve(env("OUTPUT_DIR", path.join(PROJECT_ROOT, "output"))),
  defaults: {
    companyName: env("COMPANY_NAME"),
    supportEmail: env("SUPPORT_EMAIL"),
    supportPhone: env("SUPPORT_PHONE"),
    supportHours: env("SUPPORT_HOURS"),
    supportUrl: env("SUPPORT_URL"),
  },
};

export function assertAtlassianConfigured(): void {
  const missing = Object.entries({
    ATLASSIAN_BASE_URL: config.atlassian.baseUrl,
    ATLASSIAN_EMAIL: config.atlassian.email,
    ATLASSIAN_API_TOKEN: config.atlassian.token,
  })
    .filter(([, v]) => !v)
    .map(([k]) => k);
  if (missing.length) {
    throw new Error(
      `Missing Atlassian settings: ${missing.join(", ")}. Add them to the .env file in ${PROJECT_ROOT} or to the "env" block of your MCP client config.`,
    );
  }
}
