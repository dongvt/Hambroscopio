# To-do list

Work through this list one item at a time. Each slice ends with passing tests and a commit.

Legend: **[you]** means a manual step for Govert (accounts, keys, portals). Everything else is a coding step for opencode.

Setup guides live in `docs/setup/`, one file per tool.

---

## Phase A: Accounts and access (blockers, can run in parallel with slice 1)

- [x] **[you]** Anthropic: create the bot's API key and set a spend limit. See `docs/setup/anthropic.md`.
- [x] **[you]** Google Cloud: create a project, enable the Sheets and Calendar APIs, create a service account and set up impersonation (ADC). See `docs/setup/google-cloud.md`.
- [x] **[you]** Google Sheets: create the `dev_` spreadsheet with all five tabs and share it with the service account. See `docs/setup/google-sheets.md`.
- [x] **[you]** Google Calendar: create the dev calendar and share it with the service account. See `docs/setup/google-calendar.md`.
- [x] **[you]** Discord: create the dev bot, invite it to the server, create the hidden dev channel, collect the IDs. See `docs/setup/discord.md`.
- [x] **[you]** Copy `.env.example` to `.env` and fill in the values (after slice 1 creates the template).

## Slice 1: Repo scaffold, config, logging

- [x] Init the Node 26 LTS + TypeScript project (`package.json`, `tsconfig.json`, ESM).
- [x] Add vitest, eslint and prettier, plus `npm` scripts: `dev`, `build`, `start`, `test`, `lint`, `typecheck`.
- [x] Create the folder layout from `docs/PLAN.md` section 5 (only the folders needed so far).
- [x] Write `AGENTS.md` (commands, layout, conventions, "tests never call real APIs").
- [x] Create `.env.example` with every variable and a comment per line. Add `.gitignore` (`.env`, `*.sqlite`, `secrets/`, `node_modules`, `dist`).
- [x] `config/env.ts`: load `.env`, validate with zod, and fail fast with a clear message.
- [x] `lib/logger.ts`: pino JSON, pino-pretty when `APP_ENV=dev`, redaction of tokens, keys and auth headers.
- [x] `lib/context.ts`: correlation ID per handler or run (AsyncLocalStorage).
- [x] `lib/clock.ts` + `lib/time.ts`: injectable clock, `weekId(date)`, week days, formatting in the configured time zone.
- [x] `lib/errors.ts`: app error type and the fun error message builder.
- [x] Tests: env validation, redaction, week_id/time math (including a DST week).
- [ ] `git init`, first commit.

## Slice 2: Sheets client

- [x] Install `@googleapis/sheets` + `google-auth-library`. Auth with Application Default Credentials (gcloud impersonation, no key files).
- [x] `SheetsClient` interface (PLAN.md section 6.1).
- [x] `GoogleSheetsClient`: read Config, Inventory, Liked, Banned, Cooked.
- [x] Writes: update inventory quantities (batch), append Cooked, update the Cooked rating cell, append Liked, append Banned.
- [x] `FakeSheetsClient` (in memory).
- [x] `config/sheetConfig.ts`: Config tab → typed settings, with defaults for missing or invalid keys (warn).
- [x] DRY_RUN decorator: log writes instead of running them, and return plausible results.
- [x] Log every call (operation, range, duration, result).
- [x] Tests with the fake: config parsing and defaults, inventory parsing (blank or bad quantity → 0 + warning).
- [x] Manual check script: `npm run check:sheets` reads the dev sheet and prints the parsed data.
- [x] **[you]** Set up ADC impersonation (`docs/setup/google-cloud.md` step 4) and run `npm run check:sheets` successfully.
- [x] **[you]** Commit.

## Slice 3: Planner

- [x] Install `@anthropic-ai/sdk` and `zod`.
- [x] Check in the Anthropic docs: the Haiku 5.5 model ID, the thinking/effort parameter, and whether native structured outputs (JSON schema) work with thinking. Record the result in `docs/DECISIONS.md`.
- [x] `LlmClient` interface. `AnthropicLlmClient` uses native structured outputs (option A). If that isn't supported with thinking, ask for JSON in text and parse it with zod (option C).
- [x] Log model, thinking setting, tokens and latency. Log the full prompt and response at debug level.
- [x] `planner/schema.ts`: zod output schema.
- [x] `planner/prompt.ts`: the rules from spec section 7. Language: titles and recipes in the Config `language` (default English). Traditional dish names stay in their original name (for example "Ajiaco").
- [x] `planner/validate.ts`: names exist in inventory, units match, staples allowed, servings, no banned titles, no duplicates in the week, ledger replay (lunch reserves option 1 only).
- [x] `planner/planner.ts`: call → validate → retry up to 2 times with the errors → on final failure, throw an error whose message asks the user to update the inventory and run `/plan`.
- [x] `FixtureLlmClient` + a recording helper. Record one real response from the dev sheet.
- [x] Tests: ledger, each validation rule, retry flow, fixture replay.

## Slice 4: SQLite state

- [x] Install `better-sqlite3` (Linux x64 prebuilt binary).
- [x] Schema + migrations: `weeks`, `days`, `meals`, `kv`, plus `cooked_sheet_row` on meals.
- [x] Repositories for weeks, days, meals, kv.
- [x] `domain/mealState.ts`: pure state machine (planned → cooked → rated, plus needs_attention).
- [x] Tests: state machine transitions, repo round trips, week status idempotency.
- (No GCS snapshot in the MVP. The SQLite file lives on local disk.)

## Slice 5: Calendar client

- [ ] `CalendarClient` interface (PLAN.md section 6.2): create, patch, get, find by meal key.
- [ ] `GoogleCalendarClient` using the same service account.
- [ ] `FakeCalendarClient`.
- [ ] `domain/render.ts`: event title (single title, " | " for lunch, ✅ prefix), description (full recipes, AI footer, status line), trimmed version after a pick.
- [ ] DRY_RUN decorator (returns fake event IDs).
- [ ] Tests: render output, fake client behavior.
- [ ] Manual check: create and patch one event in the dev calendar.

## Slice 6: Weekly flow and Discord posting

- [ ] Install `discord.js`. Gateway with intents guilds, guild messages, guild message reactions, and partials message, reaction, user, channel.
- [ ] `DiscordGateway` interface (PLAN.md section 6.3), `DiscordJsGateway`, `FakeDiscordGateway`.
- [ ] `domain/emojis.ts`: all emoji constants.
- [ ] Render meal messages: titles + status line (Planned, Cooked, Cooked and liked, Cooked and disliked, Updating..., Needs attention).
- [ ] `flows/weeklyPlan.ts`: read sheet → plan → save → intro message + 🔄 → 7 threads ("Mon 11/09", 1-week auto-archive) → meal messages + reactions → calendar events → week `complete`.
- [ ] `/plan` slash command (allowed users only, `deferReply`, `week` option in dev). Register it in the dev guild.
- [ ] On error: post a warning in the channel with the correlation ID, and log the stack.
- [ ] Tests: weekly flow with all fakes; skips a week already `complete`.
- [ ] Manual check: `/plan` in the dev channel creates the full week and the calendar events.

## Slice 7: Reactions, cook, rating

- [ ] `discord/reactionRouter.ts`: ignore the bot → only allowed users (remove others) → only valid emojis for the current state (remove others) → reject past weeks → debounce (re-fetch after N seconds) → per-message lock.
- [ ] Active week = the week containing today. Messages in the next (already planned) week are accepted too. Older weeks are rejected.
- [ ] `flows/cook.ts`: "Updating..." → mark cooked, chosen option → deduct inventory → append to Cooked (cook date = the day of the click) → trim the calendar event + ✅ → swap reactions to 👍 👎 → re-render.
- [ ] `flows/deduct.ts`: match by trimmed, case-insensitive name, clamp at 0, record the deltas, warn about missing rows in the thread, retry once on API failure.
- [ ] `flows/rate.ts`: 👍 → Liked (if new), 👎 → Banned. Update the Cooked rating. Remove the rating reactions. Rating is final.
- [ ] On failure: needs_attention + warning message. No automatic recovery (fix SQLite manually or run `/plan`).
- [ ] Tests: each guardrail, debounce, lock, cook flow, deduction, rating.
- [ ] Manual check in dev: cook breakfast, cook a lunch option, rate both.

## Slice 8: Reload

- [ ] `flows/reloadMeal.ts`: 🔄 on a meal → plan that meal from the current inventory (other week titles passed to avoid duplicates) → edit message + calendar event → clear the user's 🔄.
- [ ] `flows/reloadWeek.ts`: 🔄 on the intro → re-plan every uncooked meal whose time is after now, through Sunday → edit each message + event → clear the user's 🔄.
- [ ] A missing message, thread or event → loud error (never create anything).
- [ ] Global reload rate limit (10 per hour).
- [ ] Tests: which meals are selected (for example Wednesday 15:00 → Wednesday dinner onward), cooked meals untouched, missing artifact error, rate limit.
- [ ] Manual check in dev.

## Slice 9: Scheduler

- [ ] Install `croner`. Tick every 15 minutes: read Config, and if past `plan_day plan_time` with no plan for the upcoming week, run the weekly flow.
- [ ] Catch-up on startup (setting, default on).
- [ ] Interrupted week (status planning or posting) → log + channel warning, wait for `/plan`.
- [ ] Tests with a fake clock: due/not due, catch-up, skip complete, interrupted.

## Slice 10: Run on this computer for the first week

- [ ] `docs/RUNBOOK.md`: how to start, stop, view logs (`npm start | pino-pretty`), fix SQLite manually, re-run `/plan`.
- [ ] `docs/E2E_CHECKLIST.md`: manual checks in dev.
- [ ] **[you]** Run the E2E checklist in dev.
- [ ] **[you]** Create the production spreadsheet, calendar and Discord bot (same guides, without the `dev` prefix). Fill in a prod `.env`.
- [ ] Run with `APP_ENV=prod` for the first real week.
- [ ] Later (not MVP): Docker, GCP VM, Secret Manager, GCS snapshot.
