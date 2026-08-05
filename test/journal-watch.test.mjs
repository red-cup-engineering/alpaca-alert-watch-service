import assert from "node:assert/strict";
import { appendFileSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { describeAlertEntry, isAlertWorthyEntry, readNewJournalEntries } from "../src/journal-watch.mjs";

test("passed/no-order entries are not alert-worthy", () => {
  assert.equal(isAlertWorthyEntry({ guard: "passed", disposition: "hold", order: null, response: null }), false);
  assert.equal(isAlertWorthyEntry({ guard: "passed", disposition: "market-closed", order: null, response: null }), false);
});

test("refused and error guards are always alert-worthy", () => {
  assert.equal(isAlertWorthyEntry({ guard: "refused", reason: "paper-trading-credentials-missing" }), true);
  assert.equal(isAlertWorthyEntry({ guard: "error", reason: "boom" }), true);
});

test("named failure dispositions under a passed guard are alert-worthy", () => {
  for (const disposition of ["clock-read-error", "clock-read-refused", "positions-read-refused", "market-data-failed", "strategy-refused", "order-transport-error"]) {
    assert.equal(isAlertWorthyEntry({ guard: "passed", disposition }), true, disposition);
  }
});

test("a placed order with a non-2xx venue status is alert-worthy; a successful placement is not", () => {
  assert.equal(isAlertWorthyEntry({ guard: "passed", disposition: "accumulate", order: { symbol: "BLK" }, response: { status: 422 } }), true);
  assert.equal(isAlertWorthyEntry({ guard: "passed", disposition: "accumulate", order: { symbol: "BLK" }, response: { status: 200 } }), false);
});

test("readNewJournalEntries on a missing file returns nothing and offset zero", () => {
  const result = readNewJournalEntries(join(mkdtempSync(join(tmpdir(), "journal-watch-")), "does-not-exist.ndjson"), 0);
  assert.deepEqual(result, { entries: [], nextOffset: 0 });
});

test("readNewJournalEntries only returns lines appended since the given offset, and filters to alert-worthy", () => {
  const dir = mkdtempSync(join(tmpdir(), "journal-watch-"));
  const path = join(dir, "decisions.ndjson");
  try {
    writeFileSync(path, `${JSON.stringify({ timestamp: "t1", guard: "passed", disposition: "hold", order: null, response: null })}\n`);
    const first = readNewJournalEntries(path, 0);
    assert.deepEqual(first.entries, []);

    appendFileSync(path, `${JSON.stringify({ timestamp: "t2", guard: "refused", reason: "paper-trading-credentials-missing" })}\n`);
    const second = readNewJournalEntries(path, first.nextOffset);
    assert.equal(second.entries.length, 1);
    assert.equal(second.entries[0].timestamp, "t2");

    const third = readNewJournalEntries(path, second.nextOffset);
    assert.deepEqual(third.entries, []);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("readNewJournalEntries re-reads from the start when the file has shrunk (rotated/truncated)", () => {
  const dir = mkdtempSync(join(tmpdir(), "journal-watch-"));
  const path = join(dir, "decisions.ndjson");
  try {
    writeFileSync(path, `${JSON.stringify({ timestamp: "t1", guard: "refused", reason: "x" })}\n${JSON.stringify({ timestamp: "t2", guard: "refused", reason: "y" })}\n`);
    const before = readNewJournalEntries(path, 0);
    assert.equal(before.entries.length, 2);

    writeFileSync(path, `${JSON.stringify({ timestamp: "t3", guard: "refused", reason: "z" })}\n`);
    const afterRotation = readNewJournalEntries(path, before.nextOffset);
    assert.equal(afterRotation.entries.length, 1);
    assert.equal(afterRotation.entries[0].timestamp, "t3");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("describeAlertEntry produces a one-line, non-empty summary", () => {
  const line = describeAlertEntry("esther-loop", { timestamp: "2026-07-23T00:00:00Z", guard: "refused", reason: "paper-trading-credentials-missing" });
  assert.match(line, /esther-loop/u);
  assert.match(line, /paper-trading-credentials-missing/u);
});
