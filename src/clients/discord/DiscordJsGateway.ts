import {
  ChannelType,
  Client,
  Events,
  GatewayIntentBits,
  Partials,
  REST,
  Routes,
  SlashCommandBuilder,
  ThreadAutoArchiveDuration,
  type Message,
  type MessageReaction,
  type PartialMessageReaction,
  type TextChannel,
  type ThreadChannel,
} from "discord.js";
import { AppError } from "../../lib/errors.js";
import type { Logger } from "../../lib/logger.js";
import type {
  CommandInvocation,
  DiscordGateway,
  MessageRef,
  ReactionAddEvent,
  ReactionSummary,
} from "./DiscordGateway.js";

export interface DiscordJsGatewayOptions {
  token: string;
  appId: string;
  guildId: string;
  logger: Logger;
}

export class DiscordJsGateway implements DiscordGateway {
  private readonly client: Client;
  private readonly rest: REST;
  private readonly logger: Logger;

  constructor(options: DiscordJsGatewayOptions) {
    this.logger = options.logger;
    this.client = new Client({
      intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.GuildMessageReactions,
      ],
      partials: [Partials.Message, Partials.Reaction, Partials.User, Partials.Channel],
    });
    this.rest = new REST({ version: "10" }).setToken(options.token);
    this.appId = options.appId;
    this.guildId = options.guildId;
    this.token = options.token;
  }

  private readonly appId: string;
  private readonly guildId: string;
  private readonly token: string;

  get botUserId(): string {
    const userId = this.client.user?.id;
    if (!userId) throw new AppError("state", "Discord client is not logged in");
    return userId;
  }

  async start(includeWeekOption: boolean): Promise<void> {
    const command = new SlashCommandBuilder()
      .setName("plan")
      .setDescription("Plan a week of family meals");
    if (includeWeekOption) {
      command.addStringOption((option) =>
        option.setName("week").setDescription("Monday date (YYYY-MM-DD)"),
      );
    }

    await this.call("registerCommands", this.guildId, () =>
      this.rest.put(Routes.applicationGuildCommands(this.appId, this.guildId), {
        body: [command.toJSON()],
      }),
    );
    await this.call("login", "gateway", () => this.client.login(this.token));
  }

  async stop(): Promise<void> {
    await this.client.destroy();
  }

  async sendMessage(channelId: string, content: string): Promise<MessageRef> {
    const message = await this.call("sendMessage", channelId, async () => {
      const channel = await this.fetchTextChannel(channelId);
      return channel.send(content);
    });
    return { channelId: message.channelId, messageId: message.id };
  }

  async findMessageByContent(channelId: string, content: string): Promise<MessageRef | null> {
    return this.call("findMessageByContent", channelId, async () => {
      const channel = await this.fetchTextChannel(channelId);
      if (!("messages" in channel)) return null;
      const messages = await channel.messages.fetch({ limit: 100 });
      const match = messages.find((message) => message.content === content);
      return match ? { channelId: match.channelId, messageId: match.id } : null;
    });
  }

  async createThread(channelId: string, name: string): Promise<{ threadId: string }> {
    const thread = await this.call("createThread", channelId, async () => {
      const channel = await this.fetchGuildTextChannel(channelId);
      return channel.threads.create({
        name,
        autoArchiveDuration: ThreadAutoArchiveDuration.OneWeek,
        type: ChannelType.PublicThread,
      });
    });
    return { threadId: thread.id };
  }

  async ensureThreadOpen(threadId: string): Promise<void> {
    await this.call("ensureThreadOpen", threadId, async () => {
      const channel = await this.client.channels.fetch(threadId);
      if (!channel || !channel.isThread()) {
        throw new AppError("not_found", `Discord thread not found: ${threadId}`);
      }
      if (channel.archived) await channel.setArchived(false);
    });
  }

  async editMessage(ref: MessageRef, content: string): Promise<void> {
    await this.call("editMessage", ref.messageId, async () => {
      const channel = await this.client.channels.fetch(ref.channelId);
      if (channel?.isThread()) await this.ensureThreadOpen(ref.channelId);
      const message = await this.fetchMessageObject(ref);
      await message.edit(content);
    });
  }

  async fetchMessage(
    ref: MessageRef,
  ): Promise<{ content: string; reactions: ReactionSummary[] } | null> {
    try {
      const message = await this.call("fetchMessage", ref.messageId, () =>
        this.fetchMessageObject(ref),
      );
      return {
        content: message.content,
        reactions: message.reactions.cache.map((reaction) => ({
          emoji: reactionKey(reaction),
          count: reaction.count ?? 0,
        })),
      };
    } catch (error) {
      if (isDiscordNotFound(error)) return null;
      throw error;
    }
  }

  async addReactions(ref: MessageRef, emojis: string[]): Promise<void> {
    for (const emoji of emojis) {
      await this.call("addReaction", `${ref.messageId}:${emoji}`, async () => {
        const message = await this.fetchMessageObject(ref);
        await message.react(emoji);
      });
    }
  }

  async removeUserReaction(ref: MessageRef, emoji: string, userId: string): Promise<void> {
    await this.call("removeUserReaction", `${ref.messageId}:${emoji}:${userId}`, async () => {
      const message = await this.fetchMessageObject(ref);
      const reaction = findReaction(message, emoji);
      if (reaction) await reaction.users.remove(userId);
    });
  }

  async removeEmoji(ref: MessageRef, emoji: string): Promise<void> {
    await this.call("removeEmoji", `${ref.messageId}:${emoji}`, async () => {
      const message = await this.fetchMessageObject(ref);
      const reaction = findReaction(message, emoji);
      if (reaction) await reaction.remove();
    });
  }

  async hasUserReaction(ref: MessageRef, emoji: string, userId: string): Promise<boolean> {
    return this.call("hasUserReaction", `${ref.messageId}:${emoji}:${userId}`, async () => {
      const message = await this.fetchMessageObject(ref);
      const reaction = findReaction(message, emoji);
      if (!reaction) return false;
      if (reaction.me && userId === this.botUserId) return true;
      const users = await reaction.users.fetch();
      return users.has(userId);
    });
  }

  async findThreadByName(channelId: string, name: string): Promise<string | null> {
    return this.call("findThreadByName", `${channelId}:${name}`, async () => {
      const channel = await this.fetchGuildTextChannel(channelId);
      const active = await channel.threads.fetchActive();
      const current = active.threads.find((thread) => thread.name === name);
      return current?.id ?? null;
    });
  }

  onReactionAdd(handler: (event: ReactionAddEvent) => Promise<void>): void {
    this.client.on(Events.MessageReactionAdd, async (reaction, user) => {
      try {
        const resolvedReaction = await resolveReaction(reaction);
        const resolvedUser = user.partial ? await user.fetch() : user;
        const event: ReactionAddEvent = {
          channelId: resolvedReaction.message.channelId,
          messageId: resolvedReaction.message.id,
          userId: resolvedUser.id,
          emoji: reactionKey(resolvedReaction),
        };
        this.logger.info({ eventType: "reactionAdd", ...event }, "discord event received");
        await handler(event);
      } catch (error) {
        this.logger.error({ err: error }, "discord reaction handler failed");
      }
    });
  }

  onSlashCommand(name: string, handler: (invocation: CommandInvocation) => Promise<void>): void {
    this.client.on(Events.InteractionCreate, async (interaction) => {
      if (!interaction.isChatInputCommand() || interaction.commandName !== name) return;
      this.logger.info(
        { command: name, userId: interaction.user.id, interactionId: interaction.id },
        "discord slash command received",
      );
      const invocation: CommandInvocation = {
        userId: interaction.user.id,
        options: {
          week: interaction.options.getString("week") ?? undefined,
        },
        defer: async () => {
          this.logger.info(
            { command: name, interactionId: interaction.id },
            "acknowledging discord slash command",
          );
          await interaction.deferReply({ ephemeral: true });
          this.logger.info(
            { command: name, interactionId: interaction.id },
            "discord slash command acknowledged",
          );
        },
        reply: async (text) => {
          if (interaction.deferred || interaction.replied) {
            await interaction.editReply(text);
          } else {
            await interaction.reply({ content: text, ephemeral: true });
          }
        },
      };

      try {
        await handler(invocation);
      } catch (error) {
        this.logger.error({ err: error, command: name }, "discord slash command handler failed");
        try {
          if (interaction.deferred || interaction.replied) {
            await interaction.editReply("The command failed. Check the bot logs.");
          } else {
            await interaction.reply({
              content: "The command failed. Check the bot logs.",
              ephemeral: true,
            });
          }
        } catch (replyError) {
          this.logger.error(
            { err: replyError, command: name, interactionId: interaction.id },
            "failed to send discord slash command error response",
          );
        }
      }
    });
  }

  private async fetchTextChannel(channelId: string): Promise<TextChannel | ThreadChannel> {
    const channel = await this.client.channels.fetch(channelId);
    if (!channel || (channel.type !== ChannelType.GuildText && !channel.isThread())) {
      throw new AppError("not_found", `Discord text channel not found: ${channelId}`);
    }
    if (!("send" in channel)) {
      throw new AppError("validation", `Discord channel cannot receive messages: ${channelId}`);
    }
    return channel;
  }

  private async fetchGuildTextChannel(channelId: string): Promise<TextChannel> {
    const channel = await this.client.channels.fetch(channelId);
    if (!channel || channel.type !== ChannelType.GuildText) {
      throw new AppError("not_found", `Discord guild text channel not found: ${channelId}`);
    }
    return channel;
  }

  private async fetchMessageObject(ref: MessageRef): Promise<Message> {
    const channel = await this.fetchTextChannel(ref.channelId);
    if (!("messages" in channel)) {
      throw new AppError("not_found", `Discord message channel not found: ${ref.channelId}`);
    }
    const message = await channel.messages.fetch(ref.messageId);
    return message.partial ? message.fetch() : message;
  }

  private async call<T>(operation: string, subject: string, fn: () => Promise<T>): Promise<T> {
    const started = performance.now();
    try {
      const result = await fn();
      this.logger.info(
        {
          service: "discord",
          operation,
          subject,
          durationMs: Math.round(performance.now() - started),
        },
        "discord call ok",
      );
      return result;
    } catch (error) {
      this.logger.error(
        {
          service: "discord",
          operation,
          subject,
          durationMs: Math.round(performance.now() - started),
          err: error,
        },
        "discord call failed",
      );
      throw error;
    }
  }
}

async function resolveReaction(
  reaction: MessageReaction | PartialMessageReaction,
): Promise<MessageReaction> {
  const resolved = reaction.partial ? await reaction.fetch() : reaction;
  if (resolved.message.partial) await resolved.message.fetch();
  return resolved;
}

function reactionKey(reaction: MessageReaction): string {
  return reaction.emoji.id
    ? `${reaction.emoji.name ?? ""}:${reaction.emoji.id}`
    : (reaction.emoji.name ?? "");
}

function findReaction(message: Message, emoji: string): MessageReaction | undefined {
  return message.reactions.cache.find((reaction) => reactionKey(reaction) === emoji);
}

function isDiscordNotFound(error: unknown): boolean {
  const value = error as { status?: unknown; code?: unknown };
  return value?.status === 404 || value?.code === 10008;
}
