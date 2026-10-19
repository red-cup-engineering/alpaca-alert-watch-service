import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { formatAlertMessage, postAdminAlert, readDiscordPlatformEnv } from "@red-cup-engineering/turntide-islands-discord-platform/admin-alert";
const ALERT_PREFIX = "[ALPACA-ALERT]";

test("formatAlertMessage prefixes with [ALPACA-ALERT] and joins lines", () => {
  const message = formatAlertMessage(ALERT_PREFIX, ["one", "two"]);
  assert.ok(message.startsWith(ALERT_PREFIX));
  assert.match(message, /one\ntwo/u);
});

test("formatAlertMessage truncates to stay under Discord's message ceiling", () => {
  const message = formatAlertMessage(ALERT_PREFIX, ["x".repeat(5000)]);
  assert.ok(message.length <= 1900);
  assert.ok(message.endsWith("…"));
});

test("readDiscordPlatformEnv parses simple KEY=VALUE lines and ignores comments/blank lines", () => {
  const dir = mkdtempSync(join(tmpdir(), "discord-env-"));
  const path = join(dir, ".env");
  try {
    writeFileSync(path, "# comment\n\nDISCORD_BOT_TOKEN=abc123\nDISCORD_ADMIN_CHANNEL_ID=\"999\"\n");
    const env = readDiscordPlatformEnv(path);
    assert.equal(env.DISCORD_BOT_TOKEN, "abc123");
    assert.equal(env.DISCORD_ADMIN_CHANNEL_ID, "999");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("readDiscordPlatformEnv on a missing file returns an empty object, not a throw", () => {
  assert.deepEqual(readDiscordPlatformEnv("/does/not/exist/.env"), {});
});

test("postAlpacaAlert refuses without a channel id or bot token", async () => {
  await assert.rejects(() => postAdminAlert(ALERT_PREFIX, ["x"], { env: { DISCORD_BOT_TOKEN: "t" }, channelId: undefined }), /discord-admin-channel-id-missing/u);
  await assert.rejects(() => postAdminAlert(ALERT_PREFIX, ["x"], { env: {}, channelId: "123" }), /discord-bot-token-missing/u);
});

test("postAlpacaAlert posts exactly one message through the injected transport", async () => {
  const created = [];
  const fakeTransport = { async createMessage(channelId, content) { created.push({ channelId, content }); return { id: "message-1" }; } };
  const result = await postAdminAlert(ALERT_PREFIX, ["refusal happened"], {
    env: { DISCORD_BOT_TOKEN: "t", DISCORD_ADMIN_CHANNEL_ID: "42" },
    createTransport: async () => fakeTransport,
  });
  assert.equal(result.messageId, "message-1");
  assert.equal(result.channelId, "42");
  assert.equal(created.length, 1);
  assert.match(created[0].content, /ALPACA-ALERT/u);
  assert.match(created[0].content, /refusal happened/u);
});
