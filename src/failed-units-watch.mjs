// systemd --user failed-unit detection for the alpaca units, with alert
// deduplication: a unit is reported once per failure episode, not once per
// 15-minute poll for as long as it stays failed.
//
// Accepts an optional `runSystemctl` override (same shape as
// alpaca-account-kill-switch-service/src/systemd-timers.mjs) so tests never
// touch the real host's systemd --user state.

import { execFileSync } from "node:child_process";

export const WATCHED_UNIT_GLOBS = ["alpaca-*.service", "alpaca-*.timer"];

export function realRunSystemctl(args) {
  return execFileSync("systemctl", ["--user", ...args], { encoding: "utf8" });
}

/** Names of currently-failed units matching the watched globs. */
export function currentlyFailedAlpacaUnits({ globs = WATCHED_UNIT_GLOBS, runSystemctl = realRunSystemctl } = {}) {
  const failed = new Set();
  for (const glob of globs) {
    let output;
    try {
      output = runSystemctl(["list-units", glob, "--failed", "--no-legend", "--plain", "--all"]);
    } catch {
      continue;
    }
    for (const line of output.split("\n")) {
      const name = line.trim().split(/\s+/u)[0];
      if (typeof name === "string" && name.length > 0) failed.add(name);
    }
  }
  return [...failed].sort();
}

/**
 * Given the set of unit names already alerted-on (still failed, from a prior
 * run) and the currently-failed set, return which units are newly failed
 * (alert now) and the updated alerted-set to persist (drops units that have
 * recovered, so a future re-failure alerts again).
 */
export function diffFailedUnits(previouslyAlertedUnits, currentlyFailed) {
  const previously = new Set(previouslyAlertedUnits);
  const current = new Set(currentlyFailed);
  const newlyFailed = currentlyFailed.filter((unit) => !previously.has(unit));
  return { newlyFailed, nextAlertedUnits: [...current].sort() };
}
