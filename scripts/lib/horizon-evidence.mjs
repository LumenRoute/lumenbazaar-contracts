import { deploymentOperations, testnetNetwork } from "./deployment-evidence.mjs";

export const exitCodes = Object.freeze({ verified: 0, mismatch: 1, outage: 2 });

const retryDelaysMs = [1_000, 2_000, 4_000];
const maxRetryAfterMs = 30_000;
const requestTimeoutMs = 20_000;

export class HorizonOutageError extends Error {}

// Lists every published transaction with the values Horizon must confirm. Rejections that were
// only observed in simulation have no transaction and are listed separately, never skipped silently.
export function collectPublishedTransactions(file, document) {
  const transactions = [];
  const simulationOnly = [];

  if (document.contracts && document.deployer) {
    for (const [name, contract] of Object.entries(document.contracts)) {
      for (const operation of deploymentOperations) {
        const record = contract[operation];
        transactions.push({
          file,
          label: `${name}.${operation}`,
          transactionHash: record.transactionHash,
          ledger: record.ledger,
          createdAt: record.createdAt,
          // Uploads and deploys are signed by the deployer; schema 2 initializes with the dedicated admin.
          expectedSources: [
            operation === "initialize" && document.schemaVersion >= 2 ? document.admin : document.deployer,
          ],
          expectedSuccessful: true,
        });
      }
    }
  } else if (document.kind === "live-rejection-evidence") {
    for (const record of document.setupTransactions) {
      transactions.push(explicitRecord(file, `setup.${record.name}`, record));
    }
    for (const record of document.cases) {
      if (record.recordedOn === "ledger") {
        transactions.push(explicitRecord(file, `case.${record.name}`, record));
      } else {
        simulationOnly.push({ file, label: `case.${record.name}` });
      }
    }
  } else if (Array.isArray(document.successfulOperations)) {
    for (const record of document.successfulOperations) {
      transactions.push({
        file,
        label: `operation.${record.name}`,
        transactionHash: record.transactionHash,
        ledger: record.ledger,
        createdAt: record.createdAt,
        // The 2026-10-07 lifecycle record names its actors but not each operation's signer.
        expectedSources: Object.values(document.actors),
        expectedSuccessful: true,
      });
    }
    for (const record of document.rejections ?? []) {
      simulationOnly.push({ file, label: `rejection.${record.name}` });
    }
  } else {
    throw new Error(`${file} is not a recognized public evidence document.`);
  }
  return { transactions, simulationOnly };
}

export async function verifyTransactions(
  transactions,
  { fetchImpl = fetch, sleep = defaultSleep, horizonUrl = testnetNetwork.horizonUrl } = {},
) {
  const results = [];
  for (const expected of transactions) {
    try {
      const record = await fetchTransaction(expected.transactionHash, { fetchImpl, sleep, horizonUrl });
      const differences = record ? compare(expected, record) : ["transaction not found on Horizon"];
      results.push({ ...expected, status: differences.length === 0 ? "verified" : "mismatch", differences });
    } catch (error) {
      if (!(error instanceof HorizonOutageError)) throw error;
      results.push({ ...expected, status: "outage", differences: [error.message] });
    }
  }
  return results;
}

export function exitCodeFor(results) {
  if (results.some((result) => result.status === "mismatch")) return exitCodes.mismatch;
  if (results.some((result) => result.status === "outage")) return exitCodes.outage;
  return exitCodes.verified;
}

export function renderSummary(results, simulationOnly, { fileLink = (file) => file } = {}) {
  const count = (status) => results.filter((result) => result.status === status).length;
  const code = exitCodeFor(results);
  const headline = {
    [exitCodes.verified]: "✅ VERIFIED: every published transaction matches Horizon.",
    [exitCodes.mismatch]:
      "❌ MISMATCH: Horizon contradicts published evidence. Treat this as an evidence integrity failure, not a network problem.",
    [exitCodes.outage]:
      "⚠️ OUTAGE: Horizon could not be reached after bounded retries. No published evidence was contradicted; rerun the workflow.",
  }[code];
  const files = [...new Set([...results.map((result) => result.file), ...simulationOnly.map((entry) => entry.file)])].sort();
  const lines = [
    "## Published testnet transactions vs Horizon",
    "",
    headline,
    "",
    `| Verified | Mismatch | Outage | Simulation-only (no transaction to resolve) |`,
    `| --- | --- | --- | --- |`,
    `| ${count("verified")} | ${count("mismatch")} | ${count("outage")} | ${simulationOnly.length} |`,
    "",
    "Manifests tested at this commit:",
    "",
    ...files.map((file) => `- [${file}](${fileLink(file)})`),
  ];
  const problems = results.filter((result) => result.status !== "verified");
  if (problems.length > 0) {
    lines.push("", "| Status | Manifest | Operation | Transaction | Detail |", "| --- | --- | --- | --- | --- |");
    for (const result of problems) {
      lines.push(
        `| ${result.status.toUpperCase()} | ${result.file} | ${result.label} | [${result.transactionHash.slice(0, 12)}…](https://stellar.expert/explorer/testnet/tx/${result.transactionHash}) | ${result.differences.join("; ")} |`,
      );
    }
  }
  return `${lines.join("\n")}\n`;
}

async function fetchTransaction(hash, { fetchImpl, sleep, horizonUrl }) {
  let lastProblem = "no response";
  for (let attempt = 0; attempt <= retryDelaysMs.length; attempt += 1) {
    let response;
    try {
      response = await fetchImpl(`${horizonUrl}/transactions/${hash}`, {
        headers: { accept: "application/json" },
        signal: AbortSignal.timeout(requestTimeoutMs),
      });
    } catch (error) {
      lastProblem = `request failed: ${error?.name === "TimeoutError" ? "timeout" : error?.message ?? error}`;
      response = null;
    }

    if (response) {
      if (response.status === 404) return null;
      if (response.ok) {
        try {
          return await response.json();
        } catch {
          lastProblem = "unreadable Horizon response";
        }
      } else if (response.status === 429 || response.status >= 500) {
        lastProblem = `HTTP ${response.status}`;
      } else {
        // Other client errors are definitive answers about the published hash, not outages.
        return { unexpectedStatus: response.status };
      }
    }

    if (attempt < retryDelaysMs.length) {
      const retryAfter = Number(response?.headers?.get?.("retry-after"));
      await sleep(
        Number.isFinite(retryAfter) && retryAfter > 0
          ? Math.min(retryAfter * 1000, maxRetryAfterMs)
          : retryDelaysMs[attempt],
      );
    }
  }
  throw new HorizonOutageError(`Horizon unavailable after ${retryDelaysMs.length + 1} attempts (${lastProblem})`);
}

function compare(expected, record) {
  if (record.unexpectedStatus) {
    return [`Horizon rejected the lookup with HTTP ${record.unexpectedStatus}`];
  }
  const differences = [];
  if (record.hash !== expected.transactionHash) differences.push("hash differs");
  if (record.ledger !== expected.ledger) differences.push(`ledger ${record.ledger} != published ${expected.ledger}`);
  if (Date.parse(record.created_at) !== Date.parse(expected.createdAt)) {
    differences.push(`close time ${record.created_at} != published ${expected.createdAt}`);
  }
  if (!expected.expectedSources.includes(record.source_account)) {
    differences.push(`source ${record.source_account} is not the published signer`);
  }
  if (record.successful !== expected.expectedSuccessful) {
    differences.push(
      `successful=${record.successful} but the published expected outcome is ${expected.expectedSuccessful ? "success" : "failure"}`,
    );
  }
  return differences;
}

function explicitRecord(file, label, record) {
  return {
    file,
    label,
    transactionHash: record.transactionHash,
    ledger: record.ledger,
    createdAt: record.createdAt,
    expectedSources: [record.sourceAccount],
    expectedSuccessful: record.expectedSuccessful,
  };
}

function defaultSleep(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}
