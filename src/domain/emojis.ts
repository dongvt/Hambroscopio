export const EMOJIS = {
  cooked: "✅",
  reload: "🔄",
  option1: "1️⃣",
  option2: "2️⃣",
  option3: "3️⃣",
  liked: "👍",
  disliked: "👎",
} as const;

export function optionEmoji(index: number): string | undefined {
  return [EMOJIS.option1, EMOJIS.option2, EMOJIS.option3][index];
}
