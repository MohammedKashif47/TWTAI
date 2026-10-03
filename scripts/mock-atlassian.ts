/**
 * A tiny fake Jira + Confluence used by scripts/e2e.ts to test the server without a real site.
 */
import http from "node:http";
import sharp from "sharp";

export function screen(title: string, items: string[]): Promise<Buffer> {
  const rows = items
    .map((t, i) => `<rect x="40" y="${120 + i * 60}" width="520" height="44" rx="6" fill="#f3f6fa" stroke="#c9d3df"/><text x="60" y="${148 + i * 60}" font-size="18" font-family="Arial" fill="#333">${t}</text>`)
    .join("");
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1000" height="640">
    <rect width="1000" height="640" fill="#fff"/>
    <rect width="1000" height="64" fill="#1f4e79"/>
    <text x="24" y="42" font-size="24" font-family="Arial" fill="#fff">Acme Portal</text>
    <rect x="0" y="64" width="220" height="576" fill="#eef2f7"/>
    <text x="24" y="110" font-size="16" font-family="Arial" fill="#1f4e79">Home</text>
    <text x="24" y="150" font-size="16" font-family="Arial" fill="#1f4e79">Orders</text>
    <text x="24" y="190" font-size="16" font-family="Arial" fill="#1f4e79">Settings</text>
    <g transform="translate(240,0)"><text x="40" y="104" font-size="26" font-family="Arial" fill="#222">${title}</text>${rows}</g>
  </svg>`;
  return sharp(Buffer.from(svg)).png().toBuffer();
}

export async function startMock(): Promise<{ url: string; close: () => void }> {
  const imgs = {
    home: await screen("Home", ["Recent orders", "Notifications"]),
    orders: await screen("Orders", ["Search orders", "Export", "Order #1001 - Pending"]),
    exportDlg: await screen("Export orders", ["Format: CSV | XLSX", "Date range", "Export button"]),
    spec: await screen("Spec diagram", ["Export flow"]),
  };
  let base = "";
  const issue = (key: string, summary: string, descHtml: string, extra: Record<string, unknown> = {}) => ({
    key,
    self: `${base}/rest/api/3/issue/1${key.replace(/\D/g, "")}`,
    names: { customfield_10050: "Acceptance Criteria", customfield_10019: "Rank" },
    fields: {
      summary,
      issuetype: { name: extra.subtask ? "Sub-task" : "Story" },
      status: { name: "In Progress" },
      priority: { name: "Medium" },
      project: { name: "Acme Portal" },
      labels: ["orders"],
      description: { type: "doc", content: [] },
      customfield_10019: "0|i0001:",
      customfield_10050: { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "User can export filtered orders to CSV or XLSX. Max 10,000 rows." }] }] },
      attachment: (extra.attachments as unknown[]) ?? [],
      subtasks: (extra.subtasks as unknown[]) ?? [],
      issuelinks: [],
      comment: { comments: [{ author: { displayName: "Priya (PO)" }, created: "2026-09-20T10:00:00", body: { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "Export button is visible only to users with the Order Manager role." }] }] } }] },
    },
    renderedFields: {
      description: descHtml,
      customfield_10050: "<p>User can export filtered orders to CSV or XLSX. Max 10,000 rows.</p>",
      comment: { comments: [{ body: "<p>Export button is visible only to users with the <strong>Order Manager</strong> role.</p>" }] },
    },
  });

  const server = http.createServer((req, res) => {
    const u = new URL(req.url!, base);
    const send = (code: number, body: unknown, type = "application/json") => {
      res.writeHead(code, { "content-type": type });
      res.end(type === "application/json" ? JSON.stringify(body) : (body as Buffer));
    };
    // Stands in for the short-lived, unauthenticated export URLs the Figma MCP returns.
    if (u.pathname === "/public/figma-export-dialog.png") return send(200, imgs.exportDlg, "image/png");
    if (!req.headers.authorization?.startsWith("Basic ")) return send(401, { error: "no auth" });
    const p = u.pathname;
    if (p === "/rest/api/3/issue/KAN-20")
      return send(
        200,
        issue(
          "KAN-20",
          "Order export for portal users",
          `<p>As an order manager I want to export orders so I can share them with finance.</p><p>Spec: <a href="${base}/wiki/spaces/AP/pages/555/Order+Export+Spec">Order Export Spec</a></p><p>Design: <a href="https://www.figma.com/design/AbCdEfGhIjKlMnOpQrStUv/Portal?node-id=1-2">Figma</a></p>`,
          {
            attachments: [
              { id: "1", filename: "home.png", mimeType: "image/png", size: 1, content: `${base}/att/home` },
              { id: "2", filename: "orders-page.png", mimeType: "image/png", size: 1, content: `${base}/att/orders` },
              { id: "3", filename: "notes.txt", mimeType: "text/plain", size: 1, content: `${base}/att/x` },
            ],
            subtasks: [{ key: "KAN-21", fields: { summary: "Export dialog", status: { name: "Done" } } }],
          },
        ),
      );
    if (p === "/rest/api/3/issue/KAN-21")
      return send(
        200,
        issue("KAN-21", "Export dialog", "<p>Dialog with <strong>Format</strong> (CSV, XLSX) and <strong>Date range</strong>. Select <strong>Export</strong> to download.</p>", {
          subtask: true,
          attachments: [{ id: "4", filename: "export-dialog.png", mimeType: "image/png", size: 1, content: `${base}/att/export` }],
        }),
      );
    if (p.endsWith("/remotelink")) return send(200, []);
    if (p === "/rest/api/3/search/jql") return send(200, { issues: [] });
    if (p === "/att/home") return send(200, imgs.home, "image/png");
    if (p === "/att/orders") return send(200, imgs.orders, "image/png");
    if (p === "/att/export") return send(200, imgs.exportDlg, "image/png");
    if (p === "/wiki/api/v2/pages/555")
      return send(200, {
        title: "Order Export Spec",
        body: { storage: { value: '<h2>Rules</h2><ul><li>Only Order Manager role sees Export.</li><li>Exports over 10,000 rows show the error "Narrow your filter".</li></ul><ac:image><ri:attachment ri:filename="flow.png"/></ac:image>' } },
        _links: { base: `${base}/wiki`, webui: "/spaces/AP/pages/555/Order+Export+Spec" },
      });
    if (p === "/wiki/api/v2/pages/555/attachments")
      return send(200, { results: [{ id: "att9", title: "flow.png", mediaType: "image/png", downloadLink: "/download/attachments/555/flow.png" }], _links: {} });
    if (p === "/wiki/download/attachments/555/flow.png") return send(200, imgs.spec, "image/png");
    send(404, { error: `not mocked: ${p}` });
  });
  await new Promise<void>((r) => server.listen(0, r));
  const port = (server.address() as { port: number }).port;
  base = `http://localhost:${port}`;
  return { url: base, close: () => server.close() };
}
