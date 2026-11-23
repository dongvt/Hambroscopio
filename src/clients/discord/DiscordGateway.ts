export interface MessageRef {
  channelId: string;
  messageId: string;
}

export interface ReactionSummary {
  emoji: string;
  count: number;
}

export interface ReactionAddEvent {
  channelId: string;
  messageId: string;
  userId: string;
  emoji: string;
}

export interface CommandInvocation {
  userId: string;
  options: Record<string, string | boolean | undefined>;
  defer(): Promise<void>;
  reply(text: string): Promise<void>;
}

export interface DiscordGateway {
  readonly botUserId: string;
  sendMessage(channelId: string, content: string): Promise<MessageRef>;
  findMessageByContent(channelId: string, content: string): Promise<MessageRef | null>;
  createThread(channelId: string, name: string): Promise<{ threadId: string }>;
  threadExists(threadId: string): Promise<boolean>;
  ensureThreadOpen(threadId: string): Promise<void>;
  editMessage(ref: MessageRef, content: string): Promise<void>;
  fetchMessage(ref: MessageRef): Promise<{ content: string; reactions: ReactionSummary[] } | null>;
  addReactions(ref: MessageRef, emojis: string[]): Promise<void>;
  removeUserReaction(ref: MessageRef, emoji: string, userId: string): Promise<void>;
  removeEmoji(ref: MessageRef, emoji: string): Promise<void>;
  hasUserReaction(ref: MessageRef, emoji: string, userId: string): Promise<boolean>;
  findThreadByName(channelId: string, name: string): Promise<string | null>;
  onReactionAdd(handler: (event: ReactionAddEvent) => Promise<void>): void;
  onSlashCommand(name: string, handler: (invocation: CommandInvocation) => Promise<void>): void;
}
