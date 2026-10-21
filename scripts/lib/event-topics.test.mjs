import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  EXPECTED_EVENT_LAYOUT,
  MAX_TOPIC_BYTES,
  checkEventTopics,
  topicBytes,
  topicTypeKey,
} from "./event-topics.mjs";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

function loadCommitted() {
  return {
    spec: JSON.parse(
      readFileSync(join(repoRoot, "artifacts", "spec", "upto-session.json"), "utf8"),
    ),
    fixture: JSON.parse(
      readFileSync(join(repoRoot, "artifacts", "interface", "upto-session-v3.json"), "utf8"),
    ),
  };
}

test("topicTypeKey normalizes addresses and fixed byte strings", () => {
  assert.equal(topicTypeKey("address"), "address");
  assert.equal(topicTypeKey({ bytes_n: { n: 32 } }), "bytes_n:32");
  assert.equal(topicTypeKey({ u64: {} }), 'unsupported:{"u64":{}}');
});

test("topicBytes keeps address topics and byte strings within bounds", () => {
  assert.equal(topicBytes("address"), 32);
  assert.equal(topicBytes("bytes_n:32"), 32);
  assert.ok(topicBytes("bytes_n:64") > MAX_TOPIC_BYTES);
});

test("checked-in spec and fixture agree with the reviewed event layout", () => {
  const { failures } = checkEventTopics(loadCommitted());
  assert.deepEqual(failures, []);
});

test("checkEventTopics fails when a topic name changes", () => {
  const committed = loadCommitted();
  const fixture = structuredClone(committed.fixture);
  const created = fixture.events.find((event) => event.name === "SessionCreated");
  created.fields.find((field) => field.name === "session_id").name = "session";

  const { failures } = checkEventTopics({ spec: committed.spec, fixture });
  assert.ok(failures.some((failure) => failure.includes("SessionCreated topic changed")));
});

test("checkEventTopics fails when a topic becomes unbounded", () => {
  const committed = loadCommitted();
  const fixture = structuredClone(committed.fixture);
  const created = fixture.events.find((event) => event.name === "SessionCreated");
  created.fields.find((field) => field.name === "session_id").type = {
    bytes_n: { n: 64 },
  };

  const { failures } = checkEventTopics({ spec: committed.spec, fixture });
  assert.ok(failures.some((failure) => failure.includes("exceeds the")));
});

test("checkEventTopics fails when event_version is dropped from the data map", () => {
  const committed = loadCommitted();
  const fixture = structuredClone(committed.fixture);
  const settled = fixture.events.find((event) => event.name === "SessionSettled");
  settled.fields = settled.fields.filter((field) => field.name !== "event_version");

  const { failures } = checkEventTopics({ spec: committed.spec, fixture });
  assert.ok(failures.some((failure) => failure.includes("event_version")));
});

test("reviewed layout covers every committed event with a single topic", () => {
  const { spec } = loadCommitted();
  const names = spec
    .filter((entry) => entry.event_v0 !== undefined)
    .map((entry) => entry.event_v0.name)
    .sort();
  assert.deepEqual(names, Object.keys(EXPECTED_EVENT_LAYOUT).sort());
});
