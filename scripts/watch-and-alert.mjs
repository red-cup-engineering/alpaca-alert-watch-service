#!/usr/bin/env node
// Alpaca alert watch: tails both loops' NDJSON decision journals plus the
// kill switch's tripped-record, and separately watches for alpaca systemd
// --user unit failures. Anything new since the last run is posted as one
// batched [ALPACA-ALERT] message to the TTI Discord admin channel.
//
// Run on its own 15-minute market-hours timer
// (ops/systemd/alpaca-alert-watch.timer); read-only with respect to trading
// -- it never disables a timer or touches trading state, only reads
// journals/records and systemd unit status and posts to Discord.

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describeAlertEntry, readNewJournalEntries } from "../src/journal-watch.mjs";
import { currentlyFailedAlpacaUnits, diffFailedUnits } from "../src/failed-units-watch.mjs";
import { postAlpacaAlert } from "../src/discord-alert.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const SERVICES_ROOT = join(HERE, "..", "..");
const STATE_PATH = join(HERE, "..", "data", "state", "watch-state.json");

const WATCHED_JOURNALS = [
  { label: "esther-loop", path: join(SERVICES_ROOT, "alpaca-esther-paper-trading-loop", "data", "journal", "decisions.ndjson") },
  { label: "redistributor-loop", path: join(SERVICES_ROOT, "alpaca-esther-paper-redistributor-loop", "data", "journal", "redistributor-decisions.ndjson") },
];
const KILL_SWITCH_TRIPPED_PATH = join(SERVICES_ROOT, "alpaca-account-kill-switch-service", "data", "state", "tripped", "latest.json");

function loadState() {
  try {
    return JSON.parse(readFileSync(STATE_PATH, "utf8"));
  } catch (error) {
    if (error?.code === "ENOENT") return { journalOffsets: {}, alertedFailedUnits: [], lastAlertedTripTimestamp: null };
    throw error;
  }
}

function saveState(state) {
  mkdirSync(dirname(STATE_PATH), { recursive: true });
  writeFileSync(STATE_PATH, `${JSON.stringify(state, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
}

function readLatestTrippedRecord() {
  try {
    return JSON.parse(readFileSync(KILL_SWITCH_TRIPPED_PATH, "utf8"));
  } catch (error) {
    if (error?.code === "ENOENT") return null;
    throw error;
  }
}

export async function runWatchAndAlert({
  now = () => new Date().toISOString(),
  post = postAlpacaAlert,
  loadStateImpl = loadState,
  saveStateImpl = saveState,
  journals = WATCHED_JOURNALS,
  readTripped = readLatestTrippedRecord,
  listFailedUnits = currentlyFailedAlpacaUnits,
} = {}) {
  const state = loadStateImpl();
  const lines = [];

  for (const { label, path } of journals) {
    const sinceOffset = state.journalOffsets[path] ?? 0;
    const { entries, nextOffset } = readNewJournalEntries(path, sinceOffset);
    state.journalOffsets[path] = nextOffset;
    for (const entry of entries) lines.push(describeAlertEntry(label, entry));
  }

  const trip = readTripped();
  if (trip !== null && trip.timestamp !== state.lastAlertedTripTimestamp) {
    lines.push(`[kill-switch] ${trip.timestamp}: TRIPPED -- ${(trip.reasons ?? []).join("; ")} -- disabled: ${(trip.disabledUnits ?? []).map((u) => u.unit).join(", ")}`);
    state.lastAlertedTripTimestamp = trip.timestamp;
  }

  const currentlyFailed = listFailedUnits();
  const { newlyFailed, nextAlertedUnits } = diffFailedUnits(state.alertedFailedUnits ?? [], currentlyFailed);
  state.alertedFailedUnits = nextAlertedUnits;
  for (const unit of newlyFailed) lines.push(`[unit-failure] ${unit} is in a failed state`);

  let posted = null;
  if (lines.length > 0) {
    posted = await post(lines, {});
  }

  saveStateImpl(state);
  return { checkedAt: now(), lines, posted };
}

async function main() {
  const result = await runWatchAndAlert();
  console.log(JSON.stringify(result, null, 2));
}

// Only run as a side effect when executed directly (`node scripts/watch-and-alert.mjs`),
// never on import -- so test files can import runWatchAndAlert without it firing.
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    console.error(`alert-watch-error: ${error?.message ?? error}`);
    process.exitCode = 1;
  });
}
