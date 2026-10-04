# Jira User Guide MCP Server

An MCP server that turns a Jira issue into a Word (.docx) user guide written to the Microsoft Manual of Style (MSTP).

It works alongside the **Atlassian MCP** and **Figma MCP** servers you already use. No API tokens are needed.

Give Claude an issue key or link such as `https://kashiftwtai.atlassian.net/browse/KAN-20`. Then:

1. Claude reads the issue, every sub-task and every child issue through the Atlassian MCP. That includes the description, custom fields such as Acceptance Criteria, comments and web links.
2. Claude follows each linked Confluence page through the Atlassian MCP.
3. Claude follows each linked Figma design through the Figma MCP. It reads screen names and text, and it sends each screen's screenshot to this server with `add_image`.
4. Jira screenshots go into a session inbox folder, because the Atlassian MCP can't download attachment files. Claude lists the file names, you save them into the inbox, and `import_images` picks them up.
5. Claude writes the guide and picks a descriptive title.
6. This server checks the guide against the collected sources and MSTP rules, then builds the .docx.

## What the guide contains

| Section | Content |
|---|---|
| Title page | Product, guide title (never a Jira key), subtitle, versions, date, copyright |
| Contents | Word table of contents (levels 1 and 2) |
| Introduction | Purpose, audience, what the guide covers, prerequisites, document conventions |
| One section per feature | Overview, **Go to <feature>** steps from the home screen, detailed explanation, screen elements table, procedures with results, notes, screenshots with numbered figure captions |
| Appendix | Contact information, troubleshooting, glossary, related documents |

## Tools

| Tool | Purpose |
|---|---|
| `start_guide` | Starts a session for an issue and creates its screenshot inbox folder |
| `register_source` | Records the full text of each Jira issue, Confluence page and Figma design Claude read. The guide is checked against these texts |
| `add_image` | Saves an image from a URL (such as a Figma `get_screenshot` URL) or a local file |
| `import_images` | Imports every image in the inbox folder (or another folder) |
| `record_image_text` | Records the labels and text visible on a screenshot, so the guide can use them |
| `list_session` | Shows the registered sources and images |
| `view_image` | Shows an image to Claude so step text matches the screen |
| `get_authoring_guide` | Returns the workflow, fidelity rules and MSTP style rules |
| `build_user_guide` | Validates the guide spec and writes the .docx |

The prompt `create_user_guide` runs the whole workflow. In Claude Code, type `/mcp__jira-user-guide__create_user_guide KAN-20`.

### Checks applied before building

Claude registers the full text of every Jira issue, Confluence page and Figma design it reads, plus the text it can see on each screenshot. `build_user_guide` checks the guide against those texts. Content that the sources don't support is out of scope.

These block the build:

- A feature, detail section, procedure, note or troubleshooting entry has no evidence. Evidence is a quote copied word for word from a registered source, and the server checks that the quote is really there.
- A section topic, such as "Installing Kasif" or "Configuring initial settings", doesn't appear in any source.
- A screen element, glossary term, contact name, email or phone number isn't in the sources or in your `.env` defaults.
- The title contains a Jira key or the words Jira, ticket, story or epic.
- A screenshot id doesn't exist in the collected sources.
- A collected screenshot isn't placed anywhere in the guide. Each one must appear at the step or section it shows, unless it's listed in `excludedImages` with a reason.

These come back as warnings:

- Bold UI labels, names, numbers or whole sentences that the sources barely support. Each one is probably an invention.
- Filler words such as "seamless", "comprehensive" or "best practices".
- Coverage: the build lists source statements the guide doesn't explain yet, with a percentage. Claude adds each user-relevant one, explained in full, and runs the check again.
- A navigation path doesn't start from the home screen.
- A step combines several actions or doesn't start with a verb.
- A Jira key appears in user-facing text.
- MSTP wording issues, such as "click on", "please", e.g./i.e./etc., "utilize", future tense, "log in" or "pop-up".

Run `build_user_guide` with `dryRun: true` to get the errors, warnings and coverage report without writing the file.

## Setup (Windows)

Requires Node.js 18.18 or later.

```powershell
cd E:\TWTAI\User-guide-mcp
npm install
npm run build
copy .env.example .env
```

Edit `.env` to set your Jira site (`ATLASSIAN_BASE_URL`), your project key (`JIRA_PROJECT_KEY=KAN`), your company name and your support contacts. Those fill in the appendix when the Jira issue doesn't name any. You don't need any tokens.

Make sure Claude Code has the **Atlassian** and **Figma** MCP servers connected and signed in. Check with `claude mcp list`.

### Register with Claude Code

From any project folder:

```powershell
claude mcp add jira-user-guide --scope user -- node E:/TWTAI/User-guide-mcp/dist/index.js
```

Or add it to a project `.mcp.json` (see `.mcp.json.example`). The server reads its `.env` from its own folder.

### Register with VS Code (GitHub Copilot agent mode or Claude Code extension)

Add this to `.vscode/mcp.json`:

```json
{
  "servers": {
    "jira-user-guide": {
      "type": "stdio",
      "command": "node",
      "args": ["E:/TWTAI/User-guide-mcp/dist/index.js"]
    }
  }
}
```

## Usage

Run Claude Code from any folder **other than** this project folder, for example `E:\TWTAI\Guides`. The MCP server is available everywhere once it's registered with `--scope user`. Opened inside this folder, Claude sees the server's source code and test scripts and may try to work on them instead of using the tools. `CLAUDE.md` tells it not to, but a separate folder avoids the problem entirely.

The server only accepts requests from MCP clients such as Claude Code, Claude Desktop and VS Code. If a script starts the server itself, it's refused, because a script can't read Jira through the Atlassian MCP and ends up feeding the server invented text. To allow another client, set `ALLOWED_MCP_CLIENTS` in `.env` to a comma-separated list of client names, or `*`.


### Start it with a phrase

The MCP server works on its own. It carries the trigger phrases, the full step-by-step workflow and the writing rules, so you don't need a separate skill. Once the server shows as connected in `/mcp`, type any of these in Claude Code:

```
Generate the user guide for KAN-20
Create the user guide KAN-20
create the user guide for https://kashiftwtai.atlassian.net/browse/KAN-20
Generate the user guide for 20
```

The last form uses `JIRA_PROJECT_KEY` from `.env` to turn `20` into `KAN-20`.

The server also adds two slash commands. Each one loads the whole workflow:

```
/mcp__jira-user-guide__generate_user_guide KAN-20
/mcp__jira-user-guide__create_user_guide KAN-20
```

If a plain phrase ever doesn't start the workflow, use one of these slash commands instead. They always work.

**Approvals.** To stop Claude Code asking before each of this server's tools, add it to the `permissions` section of `%USERPROFILE%\.claude\settings.json`:

```json
{
  "permissions": {
    "allow": ["mcp__jira-user-guide"]
  }
}
```

Claude Code still asks once before it uses the Atlassian and Figma MCP tools. Choose "don't ask again" if you want later runs to go through without stopping.

**Optional skill.** `skills\generate-user-guide` holds the same workflow as a Claude Code skill. You don't need it. If you installed it earlier, you can remove it by deleting `%USERPROFILE%\.claude\skills\generate-user-guide`.

Screenshots already saved in `workspace\KAN-20\inbox` are imported automatically when the session starts, and any you add later are imported at build time. If Jira attachments are missing from the inbox, Claude lists them partway through and gives you the inbox folder path. Download those attachments from Jira into that folder and tell Claude when you're done. Keep the original file names, because they become the image labels.

The finished guide is saved to `output/<Title>.docx`. You can change the folder with `OUTPUT_DIR` or the `outputDir` argument. If a guide with the same name already exists, the new one gets a timestamp so earlier versions are kept. The spec Claude wrote is saved as `workspace/<KEY>/guide-spec.json`. You can edit that file and rebuild with `build_user_guide` using `specPath`, without collecting the sources again.

When Word opens the guide, it asks whether to update fields. Select **Yes** to fill in the table of contents page numbers.

## Testing without a Jira site

```powershell
npm run e2e
```

This runs both modes through a real MCP client against a fake Jira and Confluence, and writes sample guides to `test-output\`.

To try the tools by hand, run `npm run inspect`.

## Optional: token mode

If you set `ATLASSIAN_BASE_URL`, `ATLASSIAN_EMAIL` and `ATLASSIAN_API_TOKEN` in `.env`, `add_image` can download Jira attachment URLs directly, so you don't need the inbox. If you also set `GATHER_MODE=token` and `FIGMA_TOKEN`, the server reads Jira, Confluence and Figma itself. In that mode, the tools are `collect_guide_sources` and `read_source` instead of the session tools.

## Project layout

```
src/
  index.ts            MCP server: tools, prompts and instructions
  workflow.ts         The step-by-step workflow Claude follows (sent with the server)
  ingest.ts           add_image and import_images (URLs, local files, inbox folder)
  collect.ts          Token mode: gathers issue, sub-tasks, child issues, Confluence and Figma
  jira.ts             Jira REST v3 (rendered fields, custom fields, comments, attachments)
  confluence.ts       Confluence REST v2 pages and image attachments
  figma.ts            Figma REST: screens, text, prototype links, rendered frames
  links.ts            URL detection for Jira, Confluence (including tiny links), and Figma
  images.ts           Converts every image to PNG and sizes it
  spec.ts             Guide spec schema that Claude fills in
  lint.ts             MSTP style checks
  grounding.ts        Scope, evidence and coverage checks against the source texts
  docx-builder.ts     Word layout: title page, contents, sections, figures, appendix
  authoring-guide.ts  Writing rules given to Claude
skills/
  generate-user-guide/SKILL.md   Optional: the same workflow as a Claude Code skill
scripts/
  install-skill.mjs   Copies the skill to your Claude Code skills folder
  check-keys.ts       Tests issue key detection (keys, links, phrases, bare numbers)
  mock-atlassian.ts   Fake Jira and Confluence for tests
  sample-spec.ts      The guide spec used by the tests
  e2e-mcp.ts          End-to-end test of the default MCP mode
  e2e-token.ts        End-to-end test of token mode
```

## Limits

- The Atlassian MCP doesn't return attachment files, so Jira screenshots go through the inbox folder unless you add a token.
- Figma screenshot URLs expire after a short time, so Claude saves each one right after taking it.
- Figma Make files can't be read.
- Images smaller than 48 px (icons and emoji) are skipped.
