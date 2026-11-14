export interface RenderMealEventInput {
  title: string;
  options: string[];
  selectedIndex?: number;
  statusLine: string;
  recipeText?: string;
  aiFooter?: string;
}

export function renderMealSummary(input: RenderMealEventInput): string {
  const summary = input.options.length > 1 ? input.options.join(" | ") : input.title;
  return input.selectedIndex !== undefined && input.selectedIndex >= 0
    ? `✅ ${input.options[input.selectedIndex] ?? input.title}`
    : summary;
}

export function renderMealDescription(input: RenderMealEventInput): string {
  const title = input.title;
  const recipe = input.recipeText ? `\n\n${input.recipeText}` : "";
  const footer = input.aiFooter ?? "AI-generated recipe";
  return `${title}${recipe}\n\n---\nStatus: ${input.statusLine}\nAI: ${footer}`;
}

export function renderTrimmedDescription(input: RenderMealEventInput): string {
  const selected = input.options[input.selectedIndex ?? 0] ?? input.title;
  return `${selected}\n\n---\nStatus: ${input.statusLine}\nAI: ${input.aiFooter ?? "AI-generated recipe"}`;
}
