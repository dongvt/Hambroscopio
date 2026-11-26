// Manual check: fetch one Discord thread by ID and report whether it exists.
// Set THREAD_ID below, then run `npx tsx scripts/check-discord-thread.ts`.
import { Client, GatewayIntentBits } from "discord.js";
import { loadDotEnv, loadEnv } from "../src/config/env.js";

const THREAD_ID = "1575270680864358430";

loadDotEnv();
const env = loadEnv();
const client = new Client({ intents: [GatewayIntentBits.Guilds] });

async function threadExists(threadId: string): Promise<boolean> {
  try {
    const channel = await client.channels.fetch(threadId, { force: true });
    if (!channel) return false;
    console.log(
      JSON.stringify({
        id: channel.id,
        type: channel.type,
        isThread: channel.isThread(),
        name: "name" in channel ? channel.name : undefined,
      }),
    );
    return channel.isThread();
  } catch (error) {
    const discordError = error as { code?: unknown; status?: unknown };
    if (discordError.code === 10003 || discordError.status === 404) return false;
    throw error;
  }
}

try {
  if (!/^\d{17,20}$/.test(THREAD_ID)) {
    throw new Error("Set THREAD_ID to the Discord thread ID at the top of this file.");
  }

  await client.login(env.discord.token);
  const exists = await threadExists(THREAD_ID);
  console.log(`Thread ${THREAD_ID} exists: ${exists}`);
  if (!exists) process.exitCode = 1;
} catch (error) {
  console.error(
    `Discord thread check failed: ${error instanceof Error ? error.message : String(error)}`,
  );
  process.exitCode = 1;
} finally {
  client.destroy();
}
