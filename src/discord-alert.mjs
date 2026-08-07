// Posts an [ALPACA-ALERT]-prefixed message into the TTI Discord, reusing
// turntide-islands' own Discord REST transport (the same machinery
// daily-divination-report.mts posts through) rather than building a second
// HTTP client for Discord. This module does not introduce a dedicated
// ops/alerts channel -- turntide-islands does not expose one as
// configurable today -- so it posts into the same admin channel
// daily-divination and steward diagnostics already use
// (DISCORD_ADMIN_CHANNEL_ID), with the [ALPACA-ALERT] prefix making the
// origin unambiguous in a shared channel.

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const DISCORD_PLATFORM_ROOT = join(
  HERE,
  "..", "..", "..", "..",
  "turntide-islands", "src", "apps", "turntide-islands-discord-platform",
);
const DISCORD_TRANSPORT_MODULE = join(DISCORD_PLATFORM_ROOT, "dist", "turntide-software-system", "discord.mjs");
const DISCORD_ENV_FILE = join(DISCORD_PLATFORM_ROOT, ".env");

const DISCORD_MESSAGE_LIMIT = 1900; // stay under Discord's 2000-char ceiling with headroom for the prefix

export const ALERT_PREFIX = "[ALPACA-ALERT]";

/** Read DISCORD_BOT_TOKEN / DISCORD_ADMIN_CHANNEL_ID out of the discord platform's own .env, without loading it into process.env. */
export function readDiscordPlatformEnv(envFile = DISCORD_ENV_FILE) {
  const found = {};
  let raw;
  try {
    raw = readFileSync(envFile, "utf8");
  } catch (error) {
    if (error?.code === "ENOENT") return found;
    throw error;
  }
  for (const line of raw.split(/\r?\n/u)) {
    const trimmed = line.trim();
    if (trimmed.length === 0 || trimmed.startsWith("#")) continue;
    const match = /^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)=(.*)$/u.exec(trimmed);
    if (match === null) continue;
    let value = match[2].trim();
    if ((value.startsWith("\"") && value.endsWith("\"")) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    found[match[1]] = value;
  }
  return found;
}

export function formatAlertMessage(lines) {
  const body = lines.join("\n");
  const content = `${ALERT_PREFIX} ${body}`;
  return content.length > DISCORD_MESSAGE_LIMIT
    ? `${content.slice(0, DISCORD_MESSAGE_LIMIT - 1)}…`
    : content;
}

/**
 * Post one alert message. `createTransport` is injectable for tests
 * (defaults to dynamically importing turntide-islands' real
 * DiscordRestTransport so this module has no hard import-time dependency on
 * that package being built).
 */
export async function postAlpacaAlert(lines, {
  env = readDiscordPlatformEnv(),
  channelId = env.DISCORD_ADMIN_CHANNEL_ID,
  createTransport,
} = {}) {
  if (typeof channelId !== "string" || channelId.length === 0) {
    throw new Error("discord-admin-channel-id-missing");
  }
  if (typeof env.DISCORD_BOT_TOKEN !== "string" || env.DISCORD_BOT_TOKEN.length === 0) {
    throw new Error("discord-bot-token-missing");
  }
  const makeTransport = createTransport ?? (async () => {
    const { DiscordRestTransport } = await import(DISCORD_TRANSPORT_MODULE);
    return new DiscordRestTransport({ token: env.DISCORD_BOT_TOKEN });
  });
  const transport = await makeTransport();
  const content = formatAlertMessage(lines);
  const message = await transport.createMessage(channelId, content);
  return { channelId, messageId: message.id, content };
}
