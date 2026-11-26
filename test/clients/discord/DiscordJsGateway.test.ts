import { ChannelType } from "discord.js";
import { describe, expect, it, vi } from "vitest";
import { DiscordJsGateway } from "../../../src/clients/discord/DiscordJsGateway.js";
import { createLogger } from "../../../src/lib/logger.js";

describe("DiscordJsGateway", () => {
  it("fetches saved messages from Discord instead of trusting cache", async () => {
    const fetchMessage = vi
      .fn()
      .mockRejectedValue(Object.assign(new Error("Unknown Message"), { code: 10008, status: 404 }));
    const channel = {
      type: ChannelType.GuildText,
      isThread: () => false,
      send: vi.fn(),
      messages: { fetch: fetchMessage },
    };
    const gateway = new DiscordJsGateway({
      token: "test-token",
      appId: "12345678901234567",
      guildId: "12345678901234567",
      logger: createLogger({ level: "fatal", pretty: false }),
    });
    Object.defineProperty(gateway, "client", {
      value: { channels: { fetch: vi.fn().mockResolvedValue(channel) } },
    });

    await expect(
      gateway.fetchMessage({ channelId: "12345678901234567", messageId: "23456789012345678" }),
    ).resolves.toBeNull();
    expect(fetchMessage).toHaveBeenCalledWith({
      message: "23456789012345678",
      force: true,
    });
  });
});
