import assert from "node:assert/strict";
import test from "node:test";

import { currentlyFailedAlpacaUnits, diffFailedUnits } from "../src/failed-units-watch.mjs";

function fakeSystemctlWithFailed(failedByGlobPattern) {
  return (args) => {
    if (args[0] !== "list-units") throw new Error(`unexpected: ${args.join(" ")}`);
    const glob = args[1];
    const units = failedByGlobPattern[glob] ?? [];
    return units.map((unit) => `${unit} loaded failed failed ${unit}`).join("\n");
  };
}

test("currentlyFailedAlpacaUnits reports nothing when systemctl reports nothing failed", () => {
  const runSystemctl = fakeSystemctlWithFailed({});
  assert.deepEqual(currentlyFailedAlpacaUnits({ runSystemctl }), []);
});

test("currentlyFailedAlpacaUnits merges and dedupes across service and timer globs", () => {
  const runSystemctl = fakeSystemctlWithFailed({
    "alpaca-*.service": ["alpaca-esther-paper-trading-loop.service"],
    "alpaca-*.timer": ["alpaca-esther-paper-trading-loop.service"],
  });
  assert.deepEqual(currentlyFailedAlpacaUnits({ runSystemctl }), ["alpaca-esther-paper-trading-loop.service"]);
});

test("diffFailedUnits alerts only on newly-failed units, not ones already alerted", () => {
  const result = diffFailedUnits(["alpaca-esther-paper-trading-loop.service"], [
    "alpaca-esther-paper-trading-loop.service",
    "alpaca-kill-switch-check.service",
  ]);
  assert.deepEqual(result.newlyFailed, ["alpaca-kill-switch-check.service"]);
  assert.deepEqual(result.nextAlertedUnits, ["alpaca-esther-paper-trading-loop.service", "alpaca-kill-switch-check.service"]);
});

test("diffFailedUnits drops recovered units so a later re-failure alerts again", () => {
  const result = diffFailedUnits(["alpaca-esther-paper-trading-loop.service"], []);
  assert.deepEqual(result.newlyFailed, []);
  assert.deepEqual(result.nextAlertedUnits, []);
});
