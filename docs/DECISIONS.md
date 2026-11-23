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

## Debugging rejected plans

The ephemeral `/plan` response lists the validation issues from each model attempt. The issue categories distinguish inventory feasibility (`inventory_feasibility`), missing inventory names, unit mismatches, schema/JSON errors, duplicate or banned titles, and meal/option coverage problems.

For detailed traces, set `LOG_LEVEL=debug` in `.env`, restart the bot, and run `/plan` again. The local bot logs include the prompt sent on each attempt and the model response, plus token usage, latency, and validation issues. Look for `planner response rejected by validation`; a successful attempt logs `planner accepted response`. Keep debug logs local: they include inventory and recipe text.

The opt-in live check is `npm run check:planner`. It requires `APP_ENV=dev`, reads the configured dev sheet, and makes up to three real Anthropic requests using `ANTHROPIC_API_KEY`, `ANTHROPIC_MODEL`, and `ANTHROPIC_EFFORT`. It does not write to Sheets, Discord, or Calendar.

On 2026-11-17, the first live run with `claude-haiku-5-5` at `medium` effort failed validation because the prompt did not specify the nested recipe fields clearly enough. After adding an explicit response contract, the same live check passed with 21 meals and 35 options. This was an output-format/prompt issue, not evidence that the configured model cannot plan.

On 2026-11-22, a read-only check against the production sheet reproduced invalid JSON on all three attempts. Each response stopped at the 15,000-token output limit (`stop_reason=max_tokens`); this was truncation, not an inventory-feasibility result. A single production dinner validated on the first attempt. After raising the cap to 30,000 and using Anthropic's streaming API for long requests, the full 21-meal/35-option plan for 2026-11-23 validated on the first attempt with `claude-haiku-5-5` at `medium` effort (24,157 output tokens; about 83 seconds). The check did not write to Sheets, Calendar or Discord. Do not upgrade to Sonnet based on this incident; the tested failure was the output-token cap.
