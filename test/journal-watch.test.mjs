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

test("an incomplete NDJSON frame is retained until its newline arrives", t => {
  const dir = mkdtempSync(join(tmpdir(), "journal-watch-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const path = join(dir, "decisions.ndjson");
  const complete = JSON.stringify({ guard: "refused", reason: "first" }) + "\n";
  const later = JSON.stringify({ guard: "error", reason: "later" });
  writeFileSync(path, complete + later.slice(0, 12));
  const first = readNewJournalEntries(path);
  assert.equal(first.entries.length, 1);
  assert.equal(first.nextOffset, Buffer.byteLength(complete));
  appendFileSync(path, later.slice(12));
  assert.deepEqual(readNewJournalEntries(path, first.nextOffset), { entries: [], nextOffset: first.nextOffset });
  appendFileSync(path, "\n");
  const second = readNewJournalEntries(path, first.nextOffset);
  assert.equal(second.entries[0].reason, "later");
  assert.deepEqual(readNewJournalEntries(path, second.nextOffset).entries, []);
});

test("a split UTF-8 character and CRLF frame survive a later read", t => {
  const dir = mkdtempSync(join(tmpdir(), "journal-watch-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const path = join(dir, "decisions.ndjson");
  const bytes = Buffer.from(JSON.stringify({ guard: "refused", reason: "é" }) + "\r\n");
  const split = bytes.indexOf(Buffer.from("é")) + 1;
  writeFileSync(path, bytes.subarray(0, split));
  assert.deepEqual(readNewJournalEntries(path), { entries: [], nextOffset: 0 });
  appendFileSync(path, bytes.subarray(split));
  const result = readNewJournalEntries(path);
  assert.equal(result.entries[0].reason, "é");
  assert.equal(result.nextOffset, bytes.length);
});

test("invalid cursor values are rejected before filesystem access", () => {
  for (const offset of [-1, 0.5, NaN, Infinity, "0"]) {
    assert.throws(() => readNewJournalEntries("unused", offset), /nonnegative safe integer/);
  }
});
