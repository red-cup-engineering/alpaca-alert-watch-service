import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import test from "node:test";

test("watcher CLI help loads the published runtime without running a watch", () => {
  const result = spawnSync(process.execPath, [fileURLToPath(new URL("../scripts/watch-and-alert.mjs", import.meta.url)), "--help"], { encoding: "utf8", env: {}, timeout: 10000 });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /watch-and-alert/);
});
test("watcher CLI rejects malformed NDJSON before host or transport effects", () => {
  const result = spawnSync(process.execPath, [fileURLToPath(new URL("../scripts/watch-and-alert.mjs", import.meta.url))], { input: "{\n", encoding: "utf8", env: {}, timeout: 10000 });
  assert.equal(result.status, 2, result.stderr);
  assert.equal(JSON.parse(result.stdout).ok, false);
});
