import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { createToolContributions } from "../../../src/blueprint/toolContract";

const path = resolve(__dirname, "../package.json");
const manifest = JSON.parse(readFileSync(path, "utf8"));
const contributions = createToolContributions();
if (process.argv.includes("--check")) {
  if (JSON.stringify(manifest.contributes.languageModelTools) !== JSON.stringify(contributions)) {
    console.error("Agent tool contributions are out of date. Run npm run sync:tools.");
    process.exitCode = 1;
  } else console.log(`Agent tool contributions match ${contributions.length} implemented tools.`);
} else {
  manifest.contributes.languageModelTools = contributions;
  writeFileSync(path, JSON.stringify(manifest, null, 2) + "\n");
  console.log(`Updated ${contributions.length} Agent tool contributions.`);
}