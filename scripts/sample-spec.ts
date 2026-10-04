/**
 * The guide spec Claude would write for the fake "order export" issue used in the tests,
 * and the source texts that issue, its sub-task and the linked Confluence page contain.
 */

export const SOURCE_TEXT = {
  "jira:KAN-20": [
    "# KAN-20: Order export for portal users",
    "As an order manager I want to export orders so I can share them with finance.",
    "Acceptance Criteria: User can export filtered orders to CSV or XLSX. Max 10,000 rows.",
    "Comment from Priya (PO): Export button is visible only to users with the Order Manager role.",
    "Navigation: Home > Orders (left pane) > Export.",
  ].join("\n"),
  "jira:KAN-21": [
    "# KAN-21: Export dialog",
    "Dialog with **Format** (CSV, XLSX) and **Date range**. Select **Export** to download.",
    "The Date range limits the export to orders created between the two dates.",
  ].join("\n"),
  "confluence:555": [
    "# Order Export Spec",
    "## Rules",
    "- Only Order Manager role sees Export.",
    '- Exports over 10,000 rows show the error "Narrow your filter".',
    "(Image: flow.png)",
  ].join("\n"),
};

export const sampleSpec = (refUrl: string) => ({
  title: "Acme Portal Order Export Guide",
  subtitle: "Export orders to share with finance",
  productName: "Acme Portal",
  companyName: "Acme Corporation",
  introduction: {
    purpose: [
      "This guide explains how to export the orders that match your filter to a CSV or XLSX file, so you can share them with finance.",
    ],
    audience: "Order managers who have the *Order Manager* role.",
    prerequisites: ["You have the *Order Manager* role. Only this role sees the **Export** button."],
    overviewImageId: "img-01",
    overviewImageCaption: "Acme Portal home screen",
  },
  features: [
    {
      title: "Order export",
      overview: [
        "Order export creates a file from the orders that match your current filter on the **Orders** page. You choose the file format, CSV or XLSX, and a date range, and Acme Portal downloads the file. Finance can then work with the same order data that you see.",
        "Only users with the *Order Manager* role see the **Export** button. An export can contain up to 10,000 rows.",
      ],
      evidence: [
        { sourceId: "jira:KAN-20", quote: "As an order manager I want to export orders so I can share them with finance." },
        { sourceId: "jira:KAN-20", quote: "User can export filtered orders to CSV or XLSX. Max 10,000 rows." },
      ],
      navigation: {
        steps: [
          { text: "On the home screen, in the left pane, select **Orders**.", result: "The **Orders** page appears.", imageId: "img-02", imageCaption: "Orders page" },
          { text: "Select **Export**.", result: "The **Export orders** dialog box appears.", imageId: "img-03", imageCaption: "Export orders dialog box" },
        ],
      },
      details: [
        {
          heading: "Export limits",
          paragraphs: [
            "An export can contain up to 10,000 rows. If the orders that match your filter add up to more than 10,000 rows, Acme Portal does not create the file and shows the error `Narrow your filter`. Narrow the filter on the **Orders** page so that fewer orders match, and then export again.",
          ],
          evidence: [{ sourceId: "confluence:555", quote: 'Exports over 10,000 rows show the error "Narrow your filter".' }],
        },
        {
          heading: "Export flow",
          paragraphs: ["The following diagram shows the export flow from the order export specification."],
          imageId: "img-04",
          imageCaption: "Order export flow",
          evidence: [{ sourceId: "confluence:555", quote: "(Image: flow.png)" }],
        },
      ],
      uiElements: [
        { name: "Format", description: "The file type of the export: CSV or XLSX." },
        { name: "Date range", description: "Limits the export to orders created between the two dates you select." },
        { name: "Export", description: "Creates the file and downloads it." },
      ],
      procedures: [
        {
          title: "Export orders to a file",
          prerequisites: ["You have the *Order Manager* role."],
          steps: [
            { text: "On the **Orders** page, filter the list to the orders you want to export." },
            { text: "Select **Export**.", result: "The **Export orders** dialog box appears." },
            { text: "In **Format**, select **CSV** or **XLSX**." },
            { text: "In **Date range**, select the start and end dates." },
            { text: "Select **Export**.", result: "The file downloads." },
          ],
          evidence: [{ sourceId: "jira:KAN-21", quote: "Dialog with Format (CSV, XLSX) and Date range. Select Export to download." }],
        },
      ],
      notes: [
        {
          type: "important",
          text: "If you do not see the **Export** button, you do not have the *Order Manager* role. Only users with this role can export orders.",
          evidence: [{ sourceId: "jira:KAN-20", quote: "Export button is visible only to users with the Order Manager role." }],
        },
      ],
      sourceIds: ["jira:KAN-20", "jira:KAN-21", "confluence:555"],
    },
  ],
  appendix: {
    contacts: [{ role: "Product owner", name: "Priya" }, { role: "Technical support", email: "support@acme.example" }],
    glossary: [
      { term: "XLSX", definition: "One of the two export formats." },
      { term: "CSV", definition: "One of the two export formats." },
    ],
    troubleshooting: [
      {
        problem: "The error `Narrow your filter` appears.",
        solution: "The orders that match your filter add up to more than 10,000 rows. Narrow the filter and export again.",
        evidence: [{ sourceId: "confluence:555", quote: 'Exports over 10,000 rows show the error "Narrow your filter".' }],
      },
    ],
    references: [{ title: "Order Export Spec", url: refUrl }],
  },
});
