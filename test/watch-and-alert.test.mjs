import assert from "node:assert/strict";
import { appendFileSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { runWatchAndAlert } from "../scripts/watch-and-alert.mjs";

function memoryState(initial = { journalOffsets: {}, alertedFailedUnits: [], lastAlertedTripTimestamp: null }) {
  let state = initial;
  return { load: () => state, save: (next) => { state = next; }, get current() { return state; } };
}

test("an interrupted journal append reaches the original watcher once after completion", t => {
  const dir = mkdtempSync(join(tmpdir(), "watch-alert-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const path = join(dir, "decisions.ndjson");
  const row = JSON.stringify({ timestamp: "fixture-time", guard: "refused", reason: "fixture reason" });
  writeFileSync(path, row.slice(0, 15));
  const store = memoryState();
  const posts = [];
  const options = { journals: [{ label: "fixture", path }], readTripped: () => null, listFailedUnits: () => [], loadStateImpl: store.load, saveStateImpl: store.save, post: async lines => { posts.push(lines); return { messageId: "fixture" }; } };
  return (async () => {
    assert.deepEqual((await runWatchAndAlert(options)).lines, []);
    assert.equal(store.current.journalOffsets[path], 0);
    appendFileSync(path, row.slice(15) + "\n");
    assert.equal((await runWatchAndAlert(options)).lines.length, 1);
    assert.deepEqual((await runWatchAndAlert(options)).lines, []);
    assert.equal(posts.length, 1);
  })();
});

test("a clean run with nothing new posts nothing and reports no lines", async () => {
  const dir = mkdtempSync(join(tmpdir(), "watch-alert-"));
  const journalPath = join(dir, "decisions.ndjson");
  writeFileSync(journalPath, `${JSON.stringify({ timestamp: "t1", guard: "passed", disposition: "hold", order: null, response: null })}\n`);
  const store = memoryState();
  const posts = [];
  try {
    const result = await runWatchAndAlert({
      journals: [{ label: "esther-loop", path: journalPath }],
      readTripped: () => null,
      listFailedUnits: () => [],
      loadStateImpl: store.load,
      saveStateImpl: store.save,
      post: async (lines) => { posts.push(lines); return { messageId: "unused" }; },
    });
    assert.deepEqual(result.lines, []);
    assert.equal(result.posted, null);
    assert.equal(posts.length, 0);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("a refusal in the journal is posted once, and never again on a subsequent run", async () => {
  const dir = mkdtempSync(join(tmpdir(), "watch-alert-"));
  const journalPath = join(dir, "decisions.ndjson");
  writeFileSync(journalPath, `${JSON.stringify({ timestamp: "t1", guard: "refused", reason: "paper-trading-credentials-missing" })}\n`);
  const store = memoryState();
  const posts = [];
  const post = async (lines) => { posts.push(lines); return { messageId: `m${posts.length}` }; };
  try {
    const first = await runWatchAndAlert({
      journals: [{ label: "esther-loop", path: journalPath }],
      readTripped: () => null,
      listFailedUnits: () => [],
      loadStateImpl: store.load,
      saveStateImpl: store.save,
      post,
    });
    assert.equal(first.lines.length, 1);
    assert.ok(first.posted !== null);

    const second = await runWatchAndAlert({
      journals: [{ label: "esther-loop", path: journalPath }],
      readTripped: () => null,
      listFailedUnits: () => [],
      loadStateImpl: store.load,
      saveStateImpl: store.save,
      post,
    });
    assert.deepEqual(second.lines, []);
    assert.equal(posts.length, 1);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("a kill-switch trip is posted once per distinct trip timestamp", async () => {
  const store = memoryState();
  const posts = [];
  const post = async (lines) => { posts.push(lines); return { messageId: "m" }; };
  const trip = { timestamp: "2026-07-23T19:25:06.558Z", reasons: ["drawdown 49% exceeds 10%"], disabledUnits: [{ unit: "alpaca-esther-paper-trading-loop.timer" }] };

  const first = await runWatchAndAlert({ journals: [], readTripped: () => trip, listFailedUnits: () => [], loadStateImpl: store.load, saveStateImpl: store.save, post });
  assert.equal(first.lines.length, 1);
  assert.match(first.lines[0], /TRIPPED/u);

  const second = await runWatchAndAlert({ journals: [], readTripped: () => trip, listFailedUnits: () => [], loadStateImpl: store.load, saveStateImpl: store.save, post });
  assert.deepEqual(second.lines, []);
  assert.equal(posts.length, 1);
});

test("a newly-failed unit is posted once, then not again while it stays failed, then again after it recovers and re-fails", async () => {
  const store = memoryState();
  const posts = [];
  const post = async (lines) => { posts.push(lines); return { messageId: "m" }; };
  const common = { journals: [], readTripped: () => null, loadStateImpl: store.load, saveStateImpl: store.save, post };

  const first = await runWatchAndAlert({ ...common, listFailedUnits: () => ["alpaca-kill-switch-check.service"] });
  assert.equal(first.lines.length, 1);

  const second = await runWatchAndAlert({ ...common, listFailedUnits: () => ["alpaca-kill-switch-check.service"] });
  assert.deepEqual(second.lines, []);

  const recovered = await runWatchAndAlert({ ...common, listFailedUnits: () => [] });
  assert.deepEqual(recovered.lines, []);

  const refailed = await runWatchAndAlert({ ...common, listFailedUnits: () => ["alpaca-kill-switch-check.service"] });
  assert.equal(refailed.lines.length, 1);

  assert.equal(posts.length, 2);
});
