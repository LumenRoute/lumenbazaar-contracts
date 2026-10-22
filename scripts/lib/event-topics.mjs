// Indexed event topic compatibility.
//
// Indexers subscribe to a fixed event name plus one bounded topic value, then
// branch on the `event_version` field inside the data map. These helpers derive
// that layout from the canonical contract spec and from the committed interface
// fixture and assert that both agree with the reviewed expectation, so an
// accidental topic or payload change fails CI instead of silently breaking
// consumers.

// Soroban allows at most four topics per contract event.
export const MAX_EVENT_TOPICS = 4;

// A topic value must stay small: a 32-byte session id or a 32-byte address key.
export const MAX_TOPIC_BYTES = 32;

// Reviewed topic layout. `version` records the value carried in the data map and
// is asserted from Rust (`lifecycle_events_expose_indexable_topics_and_versions`);
// the spec and fixture only expose the field type, not the value.
export const EXPECTED_EVENT_LAYOUT = {
  AdminRotationAccepted: {
    prefix: "admin_rotation_accepted",
    topic: "new_admin",
    topicType: "address",
    version: 3,
  },
  AdminRotationCancelled: {
    prefix: "admin_rotation_cancelled",
    topic: "pending_admin",
    topicType: "address",
    version: 3,
  },
  AdminRotationProposed: {
    prefix: "admin_rotation_proposed",
    topic: "pending_admin",
    topicType: "address",
    version: 3,
  },
  AssetActivated: {
    prefix: "asset_activated",
    topic: "asset",
    topicType: "address",
    version: 3,
  },
  AssetDeprecated: {
    prefix: "asset_deprecated",
    topic: "asset",
    topicType: "address",
    version: 3,
  },
  AssetRemoved: {
    prefix: "asset_removed",
    topic: "asset",
    topicType: "address",
    version: 3,
  },
  AssetSessionCapUpdated: {
    prefix: "asset_session_cap_updated",
    topic: "asset",
    topicType: "address",
    version: 3,
  },
  SessionCancelled: {
    prefix: "session_cancelled",
    topic: "session_id",
    topicType: "bytes_n:32",
    version: 2,
  },
  SessionCreated: {
    prefix: "session_created",
    topic: "session_id",
    topicType: "bytes_n:32",
    version: 2,
  },
  SessionRecovered: {
    prefix: "session_recovered",
    topic: "session_id",
    topicType: "bytes_n:32",
    version: 2,
  },
  SessionSettled: {
    prefix: "session_settled",
    topic: "session_id",
    topicType: "bytes_n:32",
    version: 2,
  },
};

export function topicTypeKey(type) {
  if (typeof type === "string") {
    return type;
  }
  if (type && typeof type === "object" && type.bytes_n) {
    return `bytes_n:${type.bytes_n.n}`;
  }
  return `unsupported:${JSON.stringify(type)}`;
}

export function topicBytes(topicTypeKeyValue) {
  if (topicTypeKeyValue === "address") {
    // Account and contract addresses index by their 32-byte key.
    return 32;
  }
  const match = /^bytes_n:(\d+)$/.exec(topicTypeKeyValue);
  return match ? Number(match[1]) : Number.POSITIVE_INFINITY;
}

export function normalizeEvent(name, prefixTopics, fields) {
  return {
    name,
    prefixes: [...prefixTopics],
    topics: fields
      .filter((field) => field.location === "topic_list")
      .map((field) => ({ name: field.name, type: topicTypeKey(field.type) })),
    data: fields
      .filter((field) => field.location === "data")
      .map((field) => ({ name: field.name, type: topicTypeKey(field.type) })),
  };
}

export function eventsFromSpec(spec) {
  return spec
    .filter((entry) => entry.event_v0 !== undefined)
    .map(({ event_v0: event }) =>
      normalizeEvent(event.name, event.prefix_topics, event.params),
    );
}

export function eventsFromFixture(fixture) {
  return fixture.events.map((event) =>
    normalizeEvent(event.name, event.prefixTopics, event.fields),
  );
}

function compareEvents({ fromSpec, fromFixture }) {
  const failures = [];
  const specEvents = new Map(fromSpec.map((event) => [event.name, event]));
  const fixtureEvents = new Map(fromFixture.map((event) => [event.name, event]));
  const expectedNames = Object.keys(EXPECTED_EVENT_LAYOUT).sort();

  if ([...specEvents.keys()].sort().join(",") !== expectedNames.join(",")) {
    failures.push(
      `canonical spec event set changed: expected ${expectedNames.join(", ")}`,
    );
  }
  if ([...fixtureEvents.keys()].sort().join(",") !== expectedNames.join(",")) {
    failures.push(
      `interface fixture event set changed: expected ${expectedNames.join(", ")}`,
    );
  }

  for (const [name, expected] of Object.entries(EXPECTED_EVENT_LAYOUT)) {
    const specEvent = specEvents.get(name);
    const fixtureEvent = fixtureEvents.get(name);
    for (const [source, event] of [
      ["canonical spec", specEvent],
      ["interface fixture", fixtureEvent],
    ]) {
      if (event === undefined) {
        failures.push(`${source} is missing event ${name}`);
        continue;
      }
      if (event.prefixes.length !== 1 || event.prefixes[0] !== expected.prefix) {
        failures.push(
          `${source} ${name} must use the single prefix topic "${expected.prefix}"`,
        );
      }
      if (event.topics.length !== 1) {
        failures.push(`${source} ${name} must expose exactly one indexed topic`);
      }
      if (event.topics.length > MAX_EVENT_TOPICS) {
        failures.push(
          `${source} ${name} exceeds the ${MAX_EVENT_TOPICS}-topic Soroban limit`,
        );
      }
      const topic = event.topics[0];
      if (topic && (topic.name !== expected.topic || topic.type !== expected.topicType)) {
        failures.push(
          `${source} ${name} topic changed: expected ${expected.topic}:${expected.topicType}, found ${topic.name}:${topic.type}`,
        );
      }
      if (topic && topicBytes(topic.type) > MAX_TOPIC_BYTES) {
        failures.push(
          `${source} ${name} topic ${topic.type} exceeds the ${MAX_TOPIC_BYTES}-byte bound`,
        );
      }
      const versionField = event.data.find((field) => field.name === "event_version");
      if (versionField?.type !== "u32") {
        failures.push(`${source} ${name} is missing its u32 event_version data field`);
      }
    }
    if (specEvent && fixtureEvent && JSON.stringify(specEvent) !== JSON.stringify(fixtureEvent)) {
      failures.push(`interface fixture ${name} drifted from the canonical spec`);
    }
  }

  return failures;
}

export function checkEventTopics({ spec, fixture }) {
  const fromSpec = eventsFromSpec(spec);
  const fromFixture = eventsFromFixture(fixture);
  return { failures: compareEvents({ fromSpec, fromFixture }), fromSpec, fromFixture };
}
