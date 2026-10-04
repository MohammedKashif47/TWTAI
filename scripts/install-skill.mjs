// Copies the generate-user-guide skill into your personal Claude Code skills folder
// (%USERPROFILE%\.claude\skills on Windows, ~/.claude/skills elsewhere), so the phrases
// "generate the user guide" / "create the user guide" work in every project.
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const src = path.join(root, "skills", "generate-user-guide");
const dest = path.join(os.homedir(), ".claude", "skills", "generate-user-guide");

await fs.mkdir(dest, { recursive: true });
await fs.cp(src, dest, { recursive: true, force: true });
console.log(`Installed the skill to ${dest}`);
console.log('Restart Claude Code, then try: "Generate the user guide for KAN-20"');
