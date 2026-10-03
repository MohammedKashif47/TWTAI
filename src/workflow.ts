/**
 * The end-to-end workflow for MCP mode. It is sent to Claude in three places so the server works
 * on its own, without a separate skill: the server instructions (summary), start_guide's result,
 * and the create_user_guide / generate_user_guide prompts.
 */
export const MCP_WORKFLOW = `
# Generate a user guide from Jira

Triggered when the user says "generate the user guide", "create the user guide", "make a user guide" or similar with a Jira key (KAN-20), a Jira link, or an issue number. Claude reads Jira and Confluence through the Atlassian MCP and Figma through the Figma MCP, and uses this server (jira-user-guide) to collect screenshots, check the guide and build the Word file.

## Ground rules

- Work only through tools in this conversation: the Atlassian MCP tools (named getJiraIssue, getConfluencePage and so on, under whatever server prefix the client shows, for example \`mcp__claude_ai_Atlassian_Rovo__getJiraIssue\`), the Figma MCP tools, and this server's tools.
- Never write or run scripts (.js, .mjs, .ts, PowerShell) that start this server, call its tools, or import its code. Never run \`npm run e2e\` or anything in \`scripts/\` to make a guide. Those are tests with made-up "Acme Portal order export" data.
- Never invent, reconstruct, summarise or reuse sample text as source content. \`register_source\` content must be the text that Atlassian or Figma MCP tool calls returned in this conversation.
- If the Atlassian MCP tools or this server's tools are not available in this conversation, stop. Tell the user which ones are missing and to check \`/mcp\`. Don't look for workarounds.

## 1. Identify the issue

Take the issue from the request:

- A key such as \`KAN-20\` or \`kan-20\`.
- A link such as \`https://kashiftwtai.atlassian.net/browse/KAN-20\`.
- A bare number such as \`20\`. Pass it to \`start_guide\` as given. The server adds the project key from \`JIRA_PROJECT_KEY\`, and if that isn't set, it says so.

If the request has no issue, ask for one and stop.

## 2. Start the session

Call \`start_guide\` with the issue. To update or rebuild a guide that was already generated, pass \`reset: false\` so the collected sources and images are kept. Keep these values from its result:

- \`issueKey\`
- \`jiraSite\`, which you use as the \`cloudId\` for Atlassian MCP calls
- \`inboxFolder\`
- \`contactDefaults\`
- \`writingRules\`

Follow \`writingRules\` (also available from \`get_authoring_guide\`) for everything after this point. They are the scope, evidence and MSTP rules.

## 3. Read every source

Read through the Atlassian MCP:

1. \`getJiraIssue\` for the issue, with \`fields: ["*all"]\` and \`responseContentFormat: "markdown"\`.
2. \`getJiraIssueRemoteIssueLinks\` for the same issue.
3. \`searchJiraIssuesUsingJql\` with \`parent = <KEY>\` to find child issues.
4. The same calls for every sub-task and child issue.
5. \`getConfluencePage\` for every Confluence link you find in descriptions, comments, custom fields and remote links. Take the page id from \`/pages/<id>/\`. For a \`/wiki/x/<code>\` link, pass the code.

Read Figma through the Figma MCP, for every Figma link:

1. \`get_metadata\` with the file key and the \`node-id\` from the URL, changing \`-\` to \`:\` in the node id. This lists the screens.
2. \`get_design_context\` or \`get_metadata\` on each screen for its labels and text.
3. For every screen worth showing, \`get_screenshot\`, then pass the returned URL to \`add_image\` straight away, because the URL expires.

After you read each source, call \`register_source\` with:

- its id (\`jira:KAN-21\`, \`confluence:12345\`, \`figma:<fileKey>\`), kind, title and URL
- \`content\`: the full text you read, unshortened. For an issue, that's the summary, description, acceptance criteria and other fields, and comments. For a Confluence page, it's the page body. For Figma, it's the screen names, visible text and prototype links.

The server checks the guide against these texts. Content that no registered text supports is rejected.

## 4. Collect the Jira screenshots

The Atlassian MCP can't download attachment files.

- Screenshots already in \`inboxFolder\` are imported automatically. \`start_guide\` lists them in \`importedFromInbox\`, and \`build_user_guide\` imports any added later.
- If the issues have image attachments that aren't in the inbox yet:
  1. List their file names to the user.
  2. Ask the user to save them into \`inboxFolder\` with their original names.
  3. When the user says they're in, call \`import_images\` with \`sourceId\` set to the issue they came from.
- If the user says there are no screenshots, or skips this step, continue without them.

Call \`list_session\` to see every collected image before you write the spec.

## 5. Look at every image

Call \`view_image\` for every image id, including the ones imported from the inbox. Then call \`record_image_text\` with every label and line of text you can read on that image, exactly as shown. Recorded labels count as source text, so the guide can use them.

Then decide where each image belongs:

- Match it to the feature and step whose screen it shows, using its file name, label and recorded text.
- Attach it to the navigation step or procedure step that opens that screen, or to the \`details\` entry that describes it. Use the feature's \`images\` list when no single step fits.
- An image of the home or main screen belongs on the first navigation step, or in \`introduction.overviewImageId\`.

Every collected image must appear in the guide. The build refuses to finish while any is missing. Leave one out only when it shows nothing the guide covers, and list it in \`excludedImages\` with the reason.

## 6. Write and build

Write the guide spec as JSON to \`<workspace>/<KEY>/guide-spec.json\`. The workspace is the folder that contains \`inboxFolder\`. The spec must follow these rules:

- **Title:** choose a descriptive title from the product and its features. Never include a Jira key or the words Jira, ticket, story or epic.
- **Introduction:** purpose, audience, scope and prerequisites.
- **Features:** one section per user-facing feature. Each section has an overview, \`navigation.steps\` from the home screen with one action per step, detailed explanations, \`uiElements\`, procedures with results, notes, and \`imageId\` values on the steps whose screen they show.
- **Appendix:** contacts from the sources, or from \`contactDefaults\` when the sources have none, plus a glossary, troubleshooting and references.
- **Scope:** include only what the Jira issue, its sub-tasks and child issues, and their linked Confluence pages and Figma designs describe.
  - Never add installation, setup, initial configuration, system requirements, sign-up, security advice, best practices, FAQs or "getting started" material unless a source describes it.
  - Never add platforms, devices, browsers, versions, limits, roles, menu paths, labels or contact details from general knowledge.
  - Leave out anything a source marks as out of scope or a later phase.
- **Evidence:** every feature, \`details\` entry, procedure, note and troubleshooting entry needs \`evidence\`: one or more \`{ sourceId, quote }\` pairs with the quote copied word for word from a registered source, or from recorded screenshot text (\`image:img-NN\`). The build rejects content without a matching quote.
- **Depth:** inside that scope, explain everything the sources contain. Cover every acceptance criterion, rule, field, state, validation, permission, limit and message. For each, explain what it is, where it appears, when and why the user needs it, what the user does, what happens, and its rules. Carry over exact values such as limits, options and message text. Elaborate only by explaining source facts more fully, never by adding new ones, and don't pad with generic sentences.
- **Lists:** put lists in the \`bullets\` fields and steps in \`steps\`. The builder also turns lines that start with \`- \` or \`1. \` inside a paragraph into lists.
- **Heading numbers:** the builder adds them (1, 1.1, 1.1.1, and A.1 in the appendix). Don't type numbers into headings.

First call the \`build_user_guide\` tool with \`issueKey\`, \`specPath\` and \`dryRun: true\`. It returns:

- \`errors\`: out-of-scope or unsupported content that must be removed or backed by a real quote
- \`warnings\`: bold labels, names, numbers and sentences that don't appear in the sources, plus filler words and style issues. Treat each flagged item as a likely invention and remove it unless a source states it.
- \`coverage.uncovered\`: source statements the guide doesn't explain yet. Add each user-relevant one to the right section, explained in full. Skip only developer notes, test tasks and status updates.

Repeat the dry run until there are no errors, every collected screenshot is placed, and every user-relevant statement is covered. Then call \`build_user_guide\` again without \`dryRun\` to write the file.

- Always build through the \`build_user_guide\` MCP tool.
- Never write or run your own script that imports the server's code, such as \`dist/docx-builder.js\`. That skips the checks, leaves out every collected screenshot, and saves the file in the wrong place.
- If the tool isn't available, stop and tell the user that the jira-user-guide MCP server isn't connected. They can check it with \`/mcp\`.

- Give the user the path of the .docx file, the guide title, the number of features and figures (every collected image that isn't excluded should appear), the coverage percentage, and any unused images, skipped sources, or navigation paths the sources didn't show.

## Troubleshooting

- **"Cloud id isn't explicitly granted":** the Atlassian MCP sign-in doesn't include this site. Ask the user to reconnect the Atlassian MCP and approve access to the site.
- **Figma calls fail:** check that the Figma MCP is connected and that the user can open the file.
`.trim();

/** Short version for the server instructions, which clients load into every conversation. */
export const MCP_INSTRUCTIONS = [
  "Builds Microsoft-style (MSTP) Word user guides from a Jira issue, its sub-tasks and child issues, linked Confluence pages and Figma designs.",
  'Use it whenever the user says "generate the user guide", "create the user guide" or similar together with a Jira key (KAN-20), a Jira link, or an issue number. Start by calling start_guide with that issue: its result contains the full step-by-step workflow and writing rules. Follow them exactly.',
  "Order: start_guide (imports any screenshots already in the inbox) -> read the issue, sub-tasks, child issues, Confluence pages (Atlassian MCP) and Figma designs (Figma MCP) -> register_source with the full text of each -> Figma screenshots via get_screenshot + add_image -> ask the user to save Jira image attachments into the inbox folder, then import_images -> view_image + record_image_text for every image -> write the spec, placing every collected image at the step or section it shows -> build_user_guide with dryRun until no errors and full coverage -> build_user_guide to write the .docx.",
  "Never write scripts that start this server or call its tools, never use the test data in scripts/, and never invent source content: register_source content must be the text the Atlassian or Figma MCP tools returned in this conversation. If those tools are not available, stop and tell the user to check /mcp.",
  "Rules: include only what the sources describe (no installation, setup, configuration, FAQs or general-knowledge facts unless a source states them); back every feature, detail, procedure, note and troubleshooting entry with word-for-word evidence quotes; explain every source statement fully; always build through the build_user_guide tool, never with your own script.",
].join(" ");
