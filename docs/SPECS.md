# Meal Planning Discord Bot: MVP Spec

Draft v1, November 8, 2026.
## 1. Goal

Every Sunday evening the bot plans next week's breakfasts, lunches and dinners from the ingredients in a Google Sheet, posts only the titles in Discord, and writes the full recipes into a shared family Google Calendar. The family reacts with emojis to cook, rate and reload meals. The bot keeps the inventory, cooked history, liked list and banned list up to date.

## 2. Terms

- **Week:** Monday to Sunday, identified by its Monday date (week\_id, for example 2026-11-09).
- **Slot:** breakfast, lunch or dinner.
- **Meal:** one slot on one day. It has options: 1 for breakfast and dinner, 3 for lunch (configurable).
- **Current week:** the week that contains today.

## 3. Weekly flow

1. Sunday 18:00 America/New\_York the scheduler plans the following Monday to Sunday.
2. The bot posts an intro message in the meal channel: 'Hey, these are the suggested meals for the week', with a reload reaction.
3. For each day it creates a thread (named like 'Mon 11/09') and posts one message per meal in it.
4. For each meal it creates a calendar event.
5. During the week the family reacts to cook, rate or reload.

**Idempotency:** the week has a row in SQLite with status planning, posting or complete. If the week is complete, the scheduler skips it. If a previous run was interrupted, the bot logs it, posts an error message and waits for a manual /plan. Catch-up: if the bot starts after Sunday 18:00 and the upcoming week has no plan, it runs once (setting, default on).

## 4. Discord design

One private channel in the family server holds the intro message and seven daily threads (public threads inside the private channel; the bot unarchives a thread before editing it if needed).

**Meal messages**

- Breakfast or dinner: title plus a status line.
- Lunch: three numbered titles (1, 2, 3) plus a status line. Titles only; full recipes live in the calendar.
- Status line: Planned, Cooked, Cooked and liked, or Cooked and disliked. The message is edited in place when the state changes.

**Reactions the bot places itself**

| State | Breakfast / dinner | Lunch |
| --- | --- | --- |
| planned | ✅ 🔄 | 1️⃣ 2️⃣ 3️⃣ 🔄 |
| cooked | 👍 👎 | 👍 👎 |
| rated | none | none |

The intro message has 🔄 only. Emoji choices are constants in one file so they are easy to change.

**Reaction rules (guardrails)**

1. Only the two allowed Discord user IDs (env var) are recognized. Reactions by anyone else are removed.
2. Only the emojis the bot placed for the current state are valid. Any other emoji, from anyone, is removed immediately (needs the Manage Messages permission).
3. Once a meal is cooked, the bot removes 🔄 and the number or ✅ reactions. A new 🔄 on it is rejected and removed.
4. Debounce: when a valid reaction arrives, wait 3 seconds (config), re-fetch the message's reactions, and act only if it is still there.
5. One action at a time per message (lock). The message shows 'Updating...' while the bot works.
6. Rating is final in the MVP. Fix mistakes in the sheet by hand.
7. After a reload runs, the bot clears the user's 🔄 so the button can be used again.
8. Reactions on past weeks' messages are rejected and removed.
9. Use raw reaction events and partials so reactions on messages posted before a restart still work.

**Actions**

- **Cook (1, 2, 3 or ✅):** mark the meal cooked, record the chosen option, deduct inventory (section 8), append to the Cooked tab, trim the calendar event to the chosen recipe, switch the reactions to 👍 👎.
- **👍:** add the title to Liked if not already there. **👎:** add the title to Banned.
- **🔄 on a meal:** regenerate the options for that meal only, from the current inventory. Edit the message and the calendar event.
- **🔄 on the intro:** regenerate every meal not yet cooked from today onward, current week only. Cooked meals are untouched and their deductions are already applied.

**Reload never creates anything.** If a message, thread or calendar event referenced in state is missing, it errors out loudly (section 10). Only the scheduled weekly flow (or /plan) creates things.

## 5. Google Sheet

Two completely separate spreadsheets: production, and a dev\_-prefixed copy with the same tab names so promotion is only a config change. Access uses a Google service account.

| Tab | Columns | Notes |
| --- | --- | --- |
| Inventory | name, unit, quantity | Source of truth. The family adds or increases quantities by hand. The bot only decreases quantities and never deletes rows. Units are free text (units, g, kg, ml, cups). |
| Cooked | date, week\_id, slot, title, rating, inventory\_changes | Bot appends. inventory\_changes keeps the deltas so mistakes can be fixed by hand. |
| Liked | title, date\_added | Planner may reuse these. |
| Banned | title, date\_added | Hard exclusion in the planner. |
| Config | key, value | Read on every run. |

**Config keys and defaults**

- servings: 4 (2 adults, 2 kids)
- breakfast\_options: 1, lunch\_options: 3, dinner\_options: 1
- breakfast\_time: 07:30, lunch\_time: 12:00, dinner\_time: 18:00
- breakfast\_minutes: 30, lunch\_minutes: 45, dinner\_minutes: 60 (assumed defaults)
- timezone: America/New\_York
- language: any (English or Spanish)
- no\_repeat\_weeks: 2
- assumed\_staples: salt, pepper, water
- reaction\_debounce\_seconds: 3
- plan\_day: sunday, plan\_time: 18:00s

Tokens, API keys and allowed Discord user IDs live in env vars, never in the sheet.

## 6. Calendar

- One shared family calendar (dev has its own).
- One event per meal at the configured time and duration.
- Title: breakfast or dinner shows the title. Lunch before the pick shows the three titles separated by a vertical bar. After cooking the title gets a ✅ prefix.
- Description holds the full recipe for each option: title, servings, time, ingredients with quantities, numbered steps, notes. A footer says it is an AI-generated recipe, plus a status line.
- After a lunch pick, the description is trimmed to the chosen recipe.
- The meal key is stored in the event's private extended properties and the event ID in SQLite. Updates use events.patch by ID.

## 7. Planner

A single structured call to Claude. No agent loop and no tools in the MVP. Runtime model: Haiku 5.5 (env var), medium thinking (verify the exact parameter in the docs).

**Input:** Config, Inventory rows, Banned titles, Liked titles, titles cooked in the last no\_repeat\_weeks, the meals to plan (dates, slots, option counts), servings.

**Prompt rules**

- Use only inventory ingredients plus assumed staples.
- Use inventory row names exactly and express quantities in that row's unit.
- Ingredients are shared across the week, so nothing may go below zero.
- Never suggest a banned title. No duplicate titles within the week. Favor variety. Liked meals may come back sometimes.
- Family-friendly meals for the configured servings.
- Realistic ingredient ratios and safe cooking temperatures.

**Output (validated with zod):** per meal, a list of options, each with title, servings, time\_minutes, ingredients\_used (name, quantity, unit), steps, notes.

**Validation in code:** names must exist in the inventory. Replay a virtual ledger across the week. The ledger reserves ingredients for the first option of each lunch only; options 2 and 3 only need to be feasible at that point. On failure, retry up to 2 times feeding the errors back. If it still fails, error out.

**Self-healing:** picking option 2 or 3 deducts different ingredients than the ledger reserved, so later days may become infeasible. Reloading the week midweek re-plans the rest from the real inventory.

**Single-meal reload** uses the real current inventory and ignores reservations for other planned meals. If none of the three lunch options is possible, reloading gives three new options.

## 8. Inventory deduction

When a meal becomes cooked, for each ingredient in the chosen option: find the row by name at that moment (trimmed, case-insensitive), subtract from the current value, clamp at 0, and write that cell. If a row is not found, log a warning and mention it in the thread message. Record all deltas in Cooked.inventory\_changes. Retry once on a Sheets API failure. If it still fails, mark the meal needs\_attention and show the error message.

## 9. Bot state

SQLite tables:

- weeks: week\_id, status, channel\_id, intro\_message\_id, created\_at
- days: week\_id, date, thread\_id
- meals: id, week\_id, date, slot, status, rating, options\_json, chosen\_index, discord\_message\_id, calendar\_event\_id, updated\_at
- kv: key, value

**Persistence:** the live file stays on the VM disk. A snapshot (made with SQLite's backup API) is uploaded to a GCS bucket after state changes (debounced) and on shutdown. At startup, if there is no local file, download the latest snapshot. Enable bucket object versioning and a lifecycle rule to cap old versions. Litestream is an alternative. Never open SQLite directly on the bucket (no gcsfuse), because it needs real file locking.

## 10. Logging and errors

- pino JSON logs to stdout (Docker logs or journalctl), pretty-printed in dev.
- Every handler and run gets a short correlation ID.
- Log every Discord event (type, user ID, message ID, emoji, accepted or removed and why), every Discord API call, every Sheets and Calendar call (operation, range or event ID, duration, result), and every Claude call (model, thinking setting, input and output tokens, latency, full prompt and response at debug level).
- Redact tokens, keys and auth headers.
- On any failure, post in the relevant thread or channel a fun message such as 'Dude, encontré un error, dile a Govert que lo arregle (id: abc123)' and log the stack with the same ID.
- Keep state consistent: on partial failure mark the meal needs\_attention and do not retry blindly.
- Live debugging: journalctl -fu mealbot piped to pino-pretty, or docker logs -f.

## 11. Environments and testing

- APP\_ENV=dev or prod. Dev uses a separate Discord bot in the same server, a hidden dev channel, the dev\_ spreadsheet, a dev calendar, and its own SQLite file and bucket path. Promotion means changing env and config, not code.
- DRY\_RUN=true logs Sheets and Calendar writes instead of executing them (reads still happen). Discord posts go to the dev channel.
- A /plan slash command (allowed user IDs only) runs the weekly flow on demand, with a week override in dev.
- Unit tests with Sheets, Calendar, Discord and Claude behind interfaces. Claude responses come from recorded fixtures, so tests cost nothing. Cover ledger validation, the state machine, reaction guardrails, debounce, deduction and idempotency.
- A manual end-to-end checklist in dev before every prod deploy.

## 12. Deployment

- Small GCP VM with a persistent disk. The bot runs in Docker (build a multi-arch image so a Raspberry Pi move is easy) with restart policy unless-stopped.
- Google access through the VM's attached service account (Application Default Credentials), with no key files. Share both spreadsheets and the calendar with that service account's email. For local development use impersonation or a dev-only key.
- Secrets (Discord tokens, Anthropic key, allowed user IDs) come from Secret Manager at startup.
- Deploy: git pull, build the image, restart the container. Keep a short docs/RUNBOOK.md.

## 13. Security and cost guardrails

- Spend limit on the bot's Anthropic key, separate from the key used in opencode.
- At most 3 Claude calls per user action (1 plus 2 retries). No agent loops.
- A global reload rate limit (for example 10 per hour) to stop reaction spam.
- The bot never deletes sheet rows, and never deletes Discord content other than unauthorized reactions.
- Minimal Discord permissions: view channel, send messages, create threads, send messages in threads, read history, add reactions, manage messages. Intents: guilds, guild messages, guild message reactions. The Message Content intent is not needed.

## 14. Suggested stack

Node LTS and TypeScript, discord.js (latest stable, current Discord API version), googleapis, @anthropic-ai/sdk, better-sqlite3, @google-cloud/storage, pino, zod, croner (timezone-aware scheduling), vitest. opencode should confirm versions at install time.

## 15. Build order

Each slice ends with tests passing and a commit.

1. Repo, AGENTS.md, config loading, pino logging.
2. Sheets client (interface plus fake) reading Inventory, Config, Liked, Banned, Cooked.
3. Planner: one structured call, schema, ledger validation, fixture tests.
4. SQLite state plus bucket snapshot and restore.
5. Discord: intro message, daily threads, meal messages, bot-placed reactions (dev server).
6. Reaction handler: guardrails, debounce, cook flow, inventory deduction, rating.
7. Calendar: create and update events.
8. Reload for a single meal and for the week.
9. Scheduler, /plan, idempotency, fun error messages.
10. Deploy to the VM, prod bot, runbook.

## 16. Later phases

Natural-language changes to a recipe (swap an unavailable ingredient), lista de mercado updates, receipt photos to inventory, recipe grounding with web search, store-specific lists and ordering, nutrition facts.


