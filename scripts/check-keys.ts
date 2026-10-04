import { parseJiraKey } from "../src/links.js";
const cases: [string, string, string | null][] = [
  ["KAN-20", "", "KAN-20"],
  ["kan-20", "", "KAN-20"],
  ["https://kashiftwtai.atlassian.net/browse/KAN-20", "", "KAN-20"],
  ["https://kashiftwtai.atlassian.net/jira/software/projects/KAN/boards/1?selectedIssue=KAN-20", "", "KAN-20"],
  ["Generate the user guide for KAN-20", "", "KAN-20"],
  ["20", "KAN", "KAN-20"],
  ["#20", "KAN", "KAN-20"],
  ["create the user guide for jira 20", "KAN", "KAN-20"],
  ["create the user guide for 20", "KAN", "KAN-20"],
  ["20", "", null],
];
let bad = 0;
for (const [input, proj, want] of cases) {
  const got = parseJiraKey(input, proj);
  const ok = got === want;
  if (!ok) bad++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${JSON.stringify(input)} (project ${proj || "-"}) -> ${got}`);
}
process.exit(bad ? 1 : 0);
