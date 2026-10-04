const TEMPLATE = `
# How to write the user guide

You are writing an end-user guide from product requirements. Follow this workflow exactly.

## 1. Gather everything first
${"$"}{GATHER}
- When sources disagree, prefer the most specific and most recent: sub-task > parent issue, Confluence spec > issue description, Figma screen labels for exact UI text.

## 2. Scope: include only what the sources contain
The scope of the guide is exactly what the Jira issue, its sub-tasks and child issues, and the Confluence pages and Figma designs they link to describe. Nothing else.
- Every feature, detail section, procedure and troubleshooting entry must carry **evidence**: one or more { sourceId, quote } pairs where the quote is copied word for word from a registered source (or from screenshot text recorded with record_image_text, sourceId image:img-NN). build_user_guide rejects content whose quotes are not found.
- Do not add sections the sources do not ask for. In particular, never add installation, setup, system requirements, initial configuration, sign-up, account management, security advice, performance tips, best practices, FAQs, or "getting started" material unless a source describes it.
- Do not add facts from general knowledge: no platforms, browsers, devices, operating systems, file locations, keyboard shortcuts, versions, limits, roles, menu paths, buttons, fields, error messages or contact details that the sources do not state or show.
- If a source marks something as out of scope, a later phase, or not part of this release, leave it out.
- UI names must be the exact labels shown in Figma, screenshots or the issue text. If you read a label from a screenshot, record it with record_image_text before you use it.
- If you cannot tell how the user reaches a feature from the home screen, do not guess menu names. Write only the steps the sources support, and tell the user which path was missing when you report the result.
- The build also flags bold labels, names, terms and numbers that do not appear in the sources. Treat each flag as a likely invention: remove it or find the source that states it.

## 3. Depth: explain everything the sources contain, fully
Inside that scope, be as thorough as the sources allow. Elaborating means explaining source facts more completely, never adding new ones.
- Cover every user-relevant statement in the sources: each acceptance criterion, business rule, field, button, state, validation, permission, limit, message, and screen. build_user_guide returns a coverage report listing source statements the guide does not explain yet. Work through it until every user-relevant statement is covered.
- For each fact, explain in full sentences: what it is, where it appears on the screen, when and why the user needs it, what the user does, what happens next, and the rules and limits attached to it. Relate features to each other where the sources connect them.
- Turn each acceptance criterion into reader-facing explanation, and into a procedure when it describes something the user does.
- Give every field and control a row in uiElements with its purpose and every rule the sources state (required, format, default, maximum, who can see it).
- Use the values the sources give (names, limits, options) as concrete examples.
- Do not pad. Generic sentences that could describe any product ("intuitive", "seamless", "comprehensive", "works across all devices") add no information and are flagged.

## 4. Decide the structure
- One **feature** section per user-facing capability described in the sources. Sub-tasks and child issues usually map to features or procedures; merge technical-only tasks (APIs, refactors, test tasks) into the feature they support or omit them if they have no user-visible effect.
- Choose the **title** yourself: a descriptive name built from the product and the capability, for example "Acme Portal Order Management User Guide" or "Managing Customer Profiles in Acme Portal". Never include a Jira key, the word Jira, "ticket", "story" or "epic" in the title.

## 5. Every feature section contains
- **overview**: 2 to 4 paragraphs. What the feature is, who uses it, the problem it solves, and the outcome.
- **navigation.steps**: the path from the home screen to the feature, one click or tap per step, starting with the home screen (for example "On the home screen, select **Orders**."). Use Figma prototype navigation and screen names to get the path right. Add a "result" for steps where a new page or dialog box appears, and attach the matching screenshot with imageId.
- **details**: explanation sections covering behaviour, business rules, validations, states, permissions and limits stated in the sources.
- **uiElements**: a row for every field, button, tab and control shown on the screen, with what it does and any rule attached to it (required, format, maximum length).
- **procedures**: each task the user can perform in the feature, as numbered steps with results.
- **notes**: Note / Tip / Important / Caution items for rules the user must not miss.
- **sourceIds**: the source ids you used.
- **evidence** on the feature, on each details entry and on each procedure.

## 6. Microsoft Manual of Style (MSTP) / Microsoft Writing Style Guide rules
- Address the reader as "you". Use active voice and present tense ("The **Orders** page appears.", not "will be displayed").
- Procedures: one action per numbered step, start each step with an imperative verb, put the location before the action ("On the **File** menu, select **Save**."). Seven steps or fewer where possible; split longer tasks.
- Use **bold** for UI elements exactly as labelled in the product, *italic* for new terms and placeholders, \`monospace\` for text the user types.
- Verbs: "select" for buttons, menu items, tabs, links and check boxes; "enter" for typing into a box; "go to" for moving to a page; "sign in"/"sign out" (not log in/login); "press" for keys.
- Avoid: "please", "click on", "simply", "just", "easily", Latin abbreviations (e.g., i.e., etc., via), "utilize", "in order to", exclamation marks, "pop-up". Say "dialog box", "check box", "list".
- Headings: sentence-style capitalisation. Procedure headings start with an infinitive or gerund ("Create an order" or "Creating an order"); keep one form throughout.
- Explain acronyms on first use and add them to the glossary.
- Keep Jira keys, sprint names, ticket status and developer notes out of user-facing text.

## 7. Introduction and appendix
- introduction.purpose: what the product area does and what the reader can do after reading.
- introduction.audience: the intended roles, from the sources.
- appendix.contacts: use contacts stated in the sources (product owner, support). If the sources do not give any, use the contact defaults reported by start_guide (or collect_guide_sources). Do not invent names, emails or phone numbers.
- appendix.glossary: only terms and acronyms that appear in the sources, defined the way the sources use them.
- appendix.troubleshooting: only problems, error messages and fixes stated in the sources, each with evidence. Leave it empty if the sources have none.
- appendix.references: the Confluence pages and Figma designs you used (title and link).

## 8. Build
- Call the **build_user_guide** tool with the full spec (or write it to a JSON file and pass specPath for long guides). Never write a script that imports this server's code to build the document: that skips validation and drops every collected image.
- Headings are numbered automatically (1, 1.1, 1.1.1; A.1 in the appendix). Do not type numbers into headings.
- Put lists in the bullets fields and procedures in steps. Lines that start with "- " or "1. " inside a paragraph are also turned into lists.
- Use dryRun: true first to get the errors, warnings and coverage report without writing the file.
- Fix every error (remove out-of-scope content, correct quotes). Then work through coverage.uncovered and the flagged terms and labels. Rebuild until there are no errors and every user-relevant source statement is covered.
`.trim();


export const GATHER_WITH_MCP = `
Use the **Atlassian MCP** (Rovo) and **Figma MCP** tools to read, and this server to record what you read.
- Call **start_guide** with the issue key. It creates the session and an inbox folder for screenshots.
- Jira: call getJiraIssue for the issue with fields ["*all"] (description, custom fields such as Acceptance Criteria, comment, attachment, subtasks, issuelinks). Call getJiraIssueRemoteIssueLinks for web and Confluence links. Call searchJiraIssuesUsingJql with \`parent = <KEY>\` for child issues. Repeat for every sub-task and child issue.
- Confluence: for every Confluence link in the issues (description, comments, custom fields, remote links), call getConfluencePage with the page id from the URL (/pages/<id>/...). For /wiki/x/<code> tiny links pass the code as pageId.
- Figma: for every Figma link, call get_metadata (file key and node-id from the URL) to list screens, then get_design_context or get_metadata on each screen for its text and labels. For each screen worth showing, call get_screenshot and pass the URL it returns to **add_image** right away (the URL expires).
- Call **register_source** once for every issue, Confluence page and Figma design you read (id like jira:KAN-21, confluence:12345, figma:<fileKey>). Pass the full text you read in content (description, acceptance criteria and other fields, comments; page body; screen names and visible text). The guide is checked against these texts.
- Jira screenshots: the Atlassian MCP cannot download attachment files. List the image attachment file names to the user, ask them to save those files into the inbox folder that start_guide reported, then call **import_images**. If ATLASSIAN_API_TOKEN is set, you can instead pass each attachment's content URL to add_image.
- Call **view_image** on every collected image, then **record_image_text** with every label and line of text visible on it, exactly as shown.
`.trim();

export const GATHER_WITH_TOKEN = `
- Call **collect_guide_sources** once for the issue. It reads Jira, Confluence and Figma itself.
- Call **read_source** for EVERY source it lists. Page through long sources with the offset it returns until "hasMore" is false.
- Call **view_image** for every collected image, then **record_image_text** with every label and line of text visible on it, exactly as shown.
`.trim();

export function authoringGuide(mode: "mcp" | "token"): string {
  return TEMPLATE.replace("${GATHER}", mode === "mcp" ? GATHER_WITH_MCP : GATHER_WITH_TOKEN);
}
