// NDJSON decision-journal tailing and refusal/error detection.
//
// Both alpaca loops (alpaca-esther-paper-trading-loop and
// alpaca-esther-paper-redistributor-loop) append one JSON object per line to
// their own data/journal/*.ndjson, in the shape run-loop.mjs already writes:
//   { timestamp, guard: "refused"|"passed"|"error", disposition, reason, signal, order, response }
//
// This module never re-reads lines it has already classified: callers persist
// the returned `nextOffset` (a byte offset into the file) and pass it back in
// as `sinceOffset` next time. A shrunk file (rotated/truncated) is detected by
// comparing against the current file size and re-read from the start.

import { readFileSync, statSync } from "node:fs";

function readBytes(path) {
  return readFileSync(path);
}

const FAILURE_DISPOSITIONS = new Set([
  "clock-read-error",
  "clock-read-refused",
  "positions-read-refused",
  "market-data-failed",
  "strategy-refused",
  "order-transport-error",
]);

/** Is one already-parsed journal entry worth alerting on? */
export function isAlertWorthyEntry(entry) {
  if (entry === null || typeof entry !== "object") return false;
  if (entry.guard === "refused" || entry.guard === "error") return true;
  if (entry.guard === "passed" && FAILURE_DISPOSITIONS.has(entry.disposition)) return true;
  if (entry.guard === "passed" && entry.order !== null && entry.order !== undefined) {
    const status = entry.response?.status;
    if (!(Number.isInteger(status) && status >= 200 && status < 300)) return true;
  }
  return false;
}

/** Human-readable one-line summary of an alert-worthy entry, for a Discord message body. */
export function describeAlertEntry(journalLabel, entry) {
  const bits = [entry.disposition ?? entry.guard, entry.reason].filter(Boolean);
  const status = entry.response?.status;
  if (status !== undefined) bits.push(`venue-status=${status}`);
  return `[${journalLabel}] ${entry.timestamp ?? "unknown-time"}: ${bits.join(" -- ")}`;
}

/**
 * Read only the new lines appended to `path` since `sinceOffset`, parse each
 * as JSON (skipping unparseable/partial lines), and return both the
 * alert-worthy entries found and the offset to persist for next time.
 *
 * Missing files are treated as "nothing new" rather than an error, since a
 * loop that has never run yet has no journal.
 */
export function readNewJournalEntries(path, sinceOffset = 0) {
  let size;
  try {
    size = statSync(path).size;
  } catch (error) {
    if (error?.code === "ENOENT") return { entries: [], nextOffset: 0 };
    throw error;
  }

  const startOffset = sinceOffset > size ? 0 : sinceOffset;
  if (startOffset >= size) return { entries: [], nextOffset: size };

  const slice = readBytes(path).subarray(startOffset).toString("utf8");
  const lines = slice.split("\n").map((line) => line.trim()).filter((line) => line.length > 0);

  const entries = [];
  for (const line of lines) {
    try {
      entries.push(JSON.parse(line));
    } catch {
      // Partial trailing line from a concurrent writer: leave it for next
      // time by not advancing past it. Since NDJSON lines are appended
      // atomically in practice (single appendFileSync per decision) this is
      // a defensive no-op path, not an expected occurrence.
    }
  }
  return { entries: entries.filter(isAlertWorthyEntry), nextOffset: size };
}
