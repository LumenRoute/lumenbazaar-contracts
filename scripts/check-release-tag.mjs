// Fails closed unless the release tag is an annotated tag object that points
// at the checked-out commit and carries a signature GitHub verified.
//
//   GITHUB_TOKEN=<workflow token> node scripts/check-release-tag.mjs \
//     --tag testnet-wasm-YYYY-MM-DD --repo owner/name --commit <sha>
//
// Uses only the read-only GitHub REST API; no other secret is required.
import { verifyTagObject } from "./lib/wasm-release.mjs";

const args = Object.fromEntries(
  ["--tag", "--repo", "--commit"].map((flag) => {
    const index = process.argv.indexOf(flag);
    return [flag.slice(2), index === -1 ? undefined : process.argv[index + 1]];
  }),
);
if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(args.repo ?? "")) {
  fail(["--repo must be owner/name"]);
}
const token = process.env.GITHUB_TOKEN;
if (!token) {
  fail(["GITHUB_TOKEN is required to read the tag object"]);
}

const api = async (path) => {
  const response = await fetch(`https://api.github.com/repos/${args.repo}${path}`, {
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${token}`,
      "X-GitHub-Api-Version": "2022-11-28",
    },
  });
  if (!response.ok) {
    fail([`GitHub API ${path} returned HTTP ${response.status}; cannot verify the tag`]);
  }
  return response.json();
};

const tagName = args.tag ?? "";
if (!/^[A-Za-z0-9._-]+$/.test(tagName)) {
  fail([`invalid tag name ${JSON.stringify(tagName)}`]);
}
const ref = await api(`/git/ref/tags/${encodeURIComponent(tagName)}`);
const tagObject = ref?.object?.type === "tag" ? await api(`/git/tags/${ref.object.sha}`) : undefined;
const errors = verifyTagObject({ tagName, expectedCommit: args.commit, ref, tagObject });
if (errors.length > 0) {
  fail(errors);
}
console.log(
  `Tag ${tagName} is annotated, signed (${tagObject.verification.reason}) and points at ${args.commit}.`,
);

function fail(messages) {
  for (const message of messages) {
    console.error(`release tag: ${message}`);
  }
  console.error("release tag: see \"Tag policy\" in deployments/README.md; nothing was published.");
  process.exit(1);
}
