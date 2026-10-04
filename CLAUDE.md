# jira-user-guide MCP server

This folder contains the source code of the **jira-user-guide** MCP server. It is not a place to generate guides by writing code.

## When the user asks to generate or create a user guide

- Use the MCP tools in this conversation:
  - **Atlassian:** `getJiraIssue`, `getConfluencePage` and the other Atlassian tools, under whatever prefix the client shows, for example `mcp__claude_ai_Atlassian_Rovo__getJiraIssue`.
  - **Figma:** the Figma MCP tools.
  - **This server:** `start_guide`, `register_source`, `import_images`, `view_image`, `record_image_text`, `build_user_guide` and the rest of its tools.
- Follow the workflow that `start_guide` returns.
- Never write or run scripts (.js, .mjs, .ts, PowerShell) that start this server, connect to it as a client, call its tools, or import its code from `src/` or `dist/`.
- Never use the files in `scripts/` or `samples/` to make a guide. They are automated tests and examples built on invented "Acme Portal order export" data.
- Never invent, reconstruct or summarise source content. `register_source` content must be the text the Atlassian or Figma MCP tools returned in this conversation.
- If the Atlassian MCP tools or the jira-user-guide tools are not available in this conversation, stop. Tell the user which tools are missing and that they can check them with `/mcp`. Don't look for workarounds.

## When the user asks to change the server itself

1. Edit the files in `src/`.
2. Run `npm run build`, then `npm run e2e`. The tests use fake data and never touch Jira.
3. Tell the user to restart Claude Code so it loads the new build.
