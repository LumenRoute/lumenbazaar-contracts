import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { checkEventTopics } from "./lib/event-topics.mjs";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const spec = JSON.parse(
  readFileSync(join(repoRoot, "artifacts", "spec", "upto-session.json"), "utf8"),
);
const fixture = JSON.parse(
  readFileSync(join(repoRoot, "artifacts", "interface", "upto-session-v3.json"), "utf8"),
);

const { failures, fromFixture } = checkEventTopics({ spec, fixture });

for (const event of fromFixture) {
  const topic = event.topics[0] ?? { name: "?", type: "?" };
  console.log(`${event.name}: prefix=${event.prefixes.join(",")} topic=${topic.name}:${topic.type}`);
}

if (failures.length > 0) {
  for (const failure of failures) {
    console.error(`event topic check failed: ${failure}`);
  }
  process.exitCode = 1;
} else {
  console.log(
    `event topics verified for ${fromFixture.length} event(s) in the canonical spec and interface fixture`,
  );
}
