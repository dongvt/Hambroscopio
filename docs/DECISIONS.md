# Slice 3 decisions

## Anthropic model and thinking

- Model: `claude-haiku-5-5`
- Effort: `medium`
- Thinking on the Claude Haiku 5.5 API is adapted by the `thinking` parameter with a budget; we use the effort mapping (`none`, `low`, `medium`, `high`) and keep the payload compact and parsed with Zod.
- Native structured-output schemas are not assumed to work reliably alongside thinking. The implementation therefore sends a JSON-shaped prompt and validates the returned payload with Zod after parsing.

## Planner design

- The planner keeps all validation in code before accepting a response.
- It retries up to two times with the previous validation errors appended to the prompt.
- If it still cannot build a valid plan, it throws a planning failure that asks the family to update the inventory and rerun `/plan`.
