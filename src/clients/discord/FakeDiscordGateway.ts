import type {
  CommandInvocation,
  DiscordGateway,
  MessageRef,
  ReactionAddEvent,
  ReactionSummary,
} from "./DiscordGateway.js";

interface FakeMessage {
  ref: MessageRef;
  content: string;
  reactions: Map<string, Set<string>>;
}

export class FakeDiscordGateway implements DiscordGateway {
  readonly botUserId = "fake-bot";
  readonly calls: Array<{ operation: string; args: unknown[] }> = [];
  readonly messages = new Map<string, FakeMessage>();
  readonly threads = new Map<string, { channelId: string; name: string }>();
  private nextMessageId = 1;
  private nextThreadId = 1;
  private readonly reactionHandlers: Array<(event: ReactionAddEvent) => Promise<void>> = [];
  private readonly failures = new Map<string, unknown[]>();
  private readonly commandHandlers = new Map<
    string,
    Array<(invocation: CommandInvocation) => Promise<void>>
  >();

  async sendMessage(channelId: string, content: string): Promise<MessageRef> {
    this.record("sendMessage", [channelId, content]);
    const ref = { channelId, messageId: `fake-message-${this.nextMessageId++}` };
    this.messages.set(this.key(ref), { ref, content, reactions: new Map() });
    return ref;
  }

  async findMessageByContent(channelId: string, content: string): Promise<MessageRef | null> {
    this.record("findMessageByContent", [channelId, content]);
    for (const message of this.messages.values()) {
      if (message.ref.channelId === channelId && message.content === content) return message.ref;
    }
    return null;
  }

  async createThread(channelId: string, name: string): Promise<{ threadId: string }> {
    this.record("createThread", [channelId, name]);
    const threadId = `fake-thread-${this.nextThreadId++}`;
    this.threads.set(threadId, { channelId, name });
    return { threadId };
  }

  async ensureThreadOpen(threadId: string): Promise<void> {
    this.record("ensureThreadOpen", [threadId]);
  }

  async editMessage(ref: MessageRef, content: string): Promise<void> {
    this.record("editMessage", [ref, content]);
    this.requireMessage(ref).content = content;
  }

  async fetchMessage(
    ref: MessageRef,
  ): Promise<{ content: string; reactions: ReactionSummary[] } | null> {
    this.record("fetchMessage", [ref]);
    const message = this.messages.get(this.key(ref));
    if (!message) return null;
    return {
      content: message.content,
      reactions: [...message.reactions].map(([emoji, users]) => ({ emoji, count: users.size })),
    };
  }

  async addReactions(ref: MessageRef, emojis: string[]): Promise<void> {
    this.record("addReactions", [ref, emojis]);
    const message = this.requireMessage(ref);
    for (const emoji of emojis) {
      const users = message.reactions.get(emoji) ?? new Set<string>();
      users.add(this.botUserId);
      message.reactions.set(emoji, users);
    }
  }

  async removeUserReaction(ref: MessageRef, emoji: string, userId: string): Promise<void> {
    this.record("removeUserReaction", [ref, emoji, userId]);
    this.requireMessage(ref).reactions.get(emoji)?.delete(userId);
  }

  async removeEmoji(ref: MessageRef, emoji: string): Promise<void> {
    this.record("removeEmoji", [ref, emoji]);
    this.requireMessage(ref).reactions.delete(emoji);
  }

  async hasUserReaction(ref: MessageRef, emoji: string, userId: string): Promise<boolean> {
    this.record("hasUserReaction", [ref, emoji, userId]);
    return this.messages.get(this.key(ref))?.reactions.get(emoji)?.has(userId) ?? false;
  }

  async findThreadByName(channelId: string, name: string): Promise<string | null> {
    this.record("findThreadByName", [channelId, name]);
    for (const [threadId, thread] of this.threads) {
      if (thread.channelId === channelId && thread.name === name) return threadId;
    }
    return null;
  }

  onReactionAdd(handler: (event: ReactionAddEvent) => Promise<void>): void {
    this.reactionHandlers.push(handler);
  }

  onSlashCommand(name: string, handler: (invocation: CommandInvocation) => Promise<void>): void {
    const handlers = this.commandHandlers.get(name) ?? [];
    handlers.push(handler);
    this.commandHandlers.set(name, handlers);
  }

  async emitReactionAdd(event: ReactionAddEvent): Promise<void> {
    const ref = { channelId: event.channelId, messageId: event.messageId };
    const message = this.messages.get(this.key(ref));
    if (message) {
      const users = message.reactions.get(event.emoji) ?? new Set<string>();
      users.add(event.userId);
      message.reactions.set(event.emoji, users);
    }
    await Promise.all(this.reactionHandlers.map((handler) => handler(event)));
  }

  async emitSlashCommand(name: string, invocation: CommandInvocation): Promise<void> {
    await Promise.all((this.commandHandlers.get(name) ?? []).map((handler) => handler(invocation)));
  }

  private key(ref: MessageRef): string {
    return `${ref.channelId}:${ref.messageId}`;
  }

  private requireMessage(ref: MessageRef): FakeMessage {
    const message = this.messages.get(this.key(ref));
    if (!message) throw new Error(`Missing fake Discord message ${ref.messageId}`);
    return message;
  }

  private record(operation: string, args: unknown[]): void {
    this.calls.push({ operation, args });
    const queue = this.failures.get(operation);
    if (queue?.length) throw queue.shift();
  }

  failNext(operation: string, error: unknown = new Error(`fake ${operation} failed`)): void {
    const queue = this.failures.get(operation) ?? [];
    queue.push(error);
    this.failures.set(operation, queue);
  }
}
