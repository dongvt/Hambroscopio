# Meal Planning Discord Bot: Staff Engineer Review and Plan

Review of `docs/SPECS.md` (Draft v1, November 8, 2026). No code yet.

---

## 0. Owner decisions (Nov 10, 2026). These override anything below.

1. **Active week** = the week that contains today. The next week, once planned, also accepts reactions. Older weeks are rejected.
2. **No recovery tooling in the MVP.** On error: mark the meal needs_attention, post a warning in the channel, and log. The owner fixes SQLite by hand or re-runs `/plan`. No action log, no `/meal reset`, no orphan scanning.
3. **Infeasible week:** after the retries, post a message asking the family to update Inventory and run `/plan`.
4. **Overshoots:** no deterministic repair. Keep the spec's validation and retries. If a meal turns out to be infeasible in practice, the family reloads that meal (deduction clamps at 0).
5. **Cooked date** = the day the cook reaction was clicked.
6. Recommendations S1–S10 accepted (including adding oil to `assumed_staples`).
7. **Language:** Config `language`, default English. Traditional dish names keep their original name (for example "Ajiaco") inside English text. No Spanglish.
8. **Allowed users** = a comma-separated list in env.
9. **No GCP for the MVP.** Run on this computer first. Local SQLite file, no GCS snapshot, no Secret Manager, no Docker yet. A service account JSON key is used for Sheets and Calendar. `better-sqlite3` with the Linux prebuilt binary.
10. Errors: a warning in the channel; details in the logs.
11. Structured output: native structured outputs (option A). If unsupported with thinking, JSON text + zod (option C).
12. No daily Claude-call cap. Spend is monitored in the Claude console.
13. **Week reload** re-plans every uncooked meal whose scheduled time is after now, through Sunday (Wednesday 15:00 → Wednesday dinner onward).
14. "Updating..." appears only on the individual meal messages being changed.

Step-by-step work list: `docs/TODO.md`. Setup guides: `docs/setup/`.

---

## 1. Summary verdict

The spec is solid for an MVP: clear scope, a good no-agent-loop cost posture, sensible guardrails and a testable architecture. The main gaps:

1. **Week boundaries vs. "current week".** Between Sunday 18:00 and midnight, "current week" is the old week, but the new plan is already posted. Several rules depend on this definition and need to be decided.
2. **Multi-step side effects without a recovery model.** Weekly posting, cook and reload each touch SQLite, Sheets, Calendar and Discord. The spec says "mark needs_attention, do not retry blindly", but it does not say how a meal leaves `needs_attention`, or how `/plan` resumes a half-posted week without duplicates.
3. **LLM structured output plus thinking.** Forced tool use has historically been incompatible with extended thinking. "Haiku 5.5, medium thinking" maps to an effort-style parameter (the model list shows `none/low/medium/high/xhigh/max` variants). Verify this in a spike before slice 3.
4. **Arithmetic reliability.** A small model doing a 35-recipe shared-inventory ledger will often overshoot. Expect retries, and decide what happens when 3 attempts fail.
5. **Calendar is used by the cook flow (slice 6) but is built in slice 7.** Reorder (section 6 below).

---

## 2. Ambiguities (need an answer)

### 2.1 Time and weeks
| # | Ambiguity | Recommended decision |
|---|---|---|
| A1 | "Current week" on Sunday evening is the old week, but the new plan already exists. Is intro 🔄 on the new week allowed Sunday night? Are reactions on old-week messages still allowed on Sunday? | Define the **active week** as the newest week with status `complete` whose Sunday is on or after today. Reactions are valid on the active week, and also on the previous week until its Sunday ends. Rule 8 ("past weeks") means weeks whose Sunday is before today. |
| A2 | Intro 🔄 "from today onward": does it include today's meals whose time has already passed (for example breakfast at 14:00)? | Include today's meals that are not cooked. A meal is past only when its date is before today. Keep it simple. |
| A3 | Can a meal be cooked on a different day than planned (cook Tuesday's dinner on Monday, or Monday's on Wednesday)? | Allowed. The Cooked tab `date` is the actual cook date, and `planned_date` is added as a column (or put in notes). |
| A4 | Single-meal 🔄 on a meal whose date has already passed: allowed? | Reject and remove it, same as a past week. |
| A5 | Scheduler config (`plan_day`, `plan_time`) lives in the sheet and is "read on every run", but a cron must exist before any run. | Run a fixed tick every 15 minutes. Each tick reads Config and plans if `now >= plan_day plan_time` for the upcoming week and the week has no row. This also covers catch-up with the same code path. |
| A6 | `plan_time: 18:00s` (typo?). | Treat as `18:00`. |
| A7 | DST and server TZ: the VM is likely UTC. | Do all date math in the Config `timezone` through one `time.ts` module and an injectable `Clock`. Tests cover the DST weeks (Nov 1 and Mar 8, 2026). |

### 2.2 Discord behavior
| # | Ambiguity | Recommended decision |
|---|---|---|
| D1 | Two allowed users react at the same time (one 1️⃣, the other 2️⃣). | The lock serializes them. The first valid action wins. The second reaction is no longer valid for the new state and is removed. |
| D2 | 👍 and 👎 by different users. | The first rating wins (rating is final). Remove the other. |
| D3 | Rule 3 says the bot removes the number/✅ reactions after cooking. Does that remove the user's chosen reaction too? | Yes: remove all reactions of those emojis (needs Manage Messages). The status line records what was chosen. |
| D4 | Bot's own reactions arrive as events. | Ignore events from the bot user ID before any guardrail runs. |
| D5 | Thread names "Mon 11/09": always English? | Always English, built from the week date in Config TZ. |
| D6 | Threads auto-archive (max 1 week). Created Sunday, used until the next Sunday, so they can archive before the last dinner. Can users react on archived-thread messages? | Create threads with `autoArchiveDuration = 1 week`. The bot unarchives before editing. Verify in the spike whether reactions on archived threads produce events. If not, have the bot re-touch (unarchive) each day's thread on the morning of that day. |
| D7 | What text does "Updating..." replace, and what if the action fails? | Replace the status line with "Updating...". On success, render the new state. On failure, render `⚠️ Needs attention (id: abc123)`. |
| D8 | Language "any (English or Spanish)": does it mean the planner may mix languages per recipe? | Clarify. Recommended: `language` config is `en`, `es`, or `any` (the model picks per recipe). Bot UI strings (status lines) are English. Error messages are the fun Spanglish ones. |

### 2.3 Sheets and data
| # | Ambiguity | Recommended decision |
|---|---|---|
| S1 | Cooked tab `rating` is filled after the row is appended (cook comes first, rating later). That is an update, not an append. | Store `cooked_sheet_row` in the `meals` table. Rating updates that one cell. Before writing, re-verify that the row's `week_id/date/slot` still match; if not, search for the row. |
| S2 | Cooked `date`: the planned date or the cook date? | The cook date (see A3). Add `planned_date` if the tab can take a new column. |
| S3 | Inventory quantity cell is blank, text or a fraction ("1/2"). | Parse a number. Treat unparseable values as 0, log a warning, and exclude the row from the planner input. |
| S4 | Duplicate inventory names ("Eggs" twice). | The planner sees the merged total. Deduction subtracts from the first row, then spills into the next. Log a warning. |
| S5 | The family edits or sorts Inventory between the bot's read and write. | Read the full range and write with `batchUpdate` immediately after. Before writing, verify that `name` at the target row still matches; if not, re-read once. Accept the remaining tiny race. |
| S6 | Title matching for Liked, Banned, no-repeat and duplicates. | Normalize: lowercase, trim, collapse whitespace, strip punctuation and accents. Exact match on the normalized title. Fuzzy matching is not in MVP (document that "Chicken Tacos" vs "Tacos de pollo" won't match). |
| S7 | Staples in `ingredients_used` (salt). Cooking oil, butter, spices are not staples, so Haiku will often violate the "inventory only" rule. | Staples are allowed in output and skipped by the ledger. Recommend adding `oil, butter` or similar to `assumed_staples` (the family's call). |
| S8 | Unit mismatch (the row is `kg` and the model emits `g`). | Hard validation error: the unit must equal the row's unit after normalization. No unit conversion in MVP. |
| S9 | Invalid Config value (`servings: four`). | Validate with zod. Fall back to the default for that key and log a warning plus a one-time channel notice. |
| S10 | Do uncooked titles from last week count toward `no_repeat_weeks`? | No. Only Cooked-tab titles count, per the spec. For reloads, all titles already in the current week (cooked or planned) are passed as "do not duplicate". |

### 2.4 Planner
| # | Ambiguity | Recommended decision |
|---|---|---|
| P1 | Single-meal and week reload inputs aren't listed. They need the other titles in the week to avoid duplicates. | Reload input = standard input + `existing_week_titles` + `meals_to_plan` (subset). |
| P2 | The inventory can't support 21 meals (common late in the week or with a thin pantry). | After 3 failed validations: post the error message, set the week status to `failed`, and save nothing. Optional (decide): allow the planner to mark a meal `"skip": true` ("eat out / leftovers") so a thin pantry still produces a plan. Recommended: yes, with a cap. |
| P3 | "Options 2 and 3 only need to be feasible at that point." | Check against the ledger state **after** all earlier meals and **before** option 1 of this lunch is reserved. |
| P4 | Ledger order within a day. | breakfast → lunch → dinner, days ascending. |
| P5 | Recipe quantities vs. `servings`. | All quantities are for `servings`. A recipe's `servings` field must equal Config `servings` (validated). |
| P6 | Retries "feeding the errors back": does the model see its own previous output? | Yes: send the previous assistant JSON plus a user message listing the errors. Input grows by about the size of the output per retry (see cost). |

### 2.5 State machine and errors
| # | Ambiguity | Recommended decision |
|---|---|---|
| E1 | How does a meal or week leave `needs_attention` / interrupted `posting`? | `/plan` resumes an interrupted week (see R2). Add a dev/admin slash command, `/meal reset <meal>`, that sets a meal back to its last stable state and re-renders it. Without it, the only fix is editing SQLite by hand. |
| E2 | `/plan` on a week that is already `complete`. | Refuse unless `force:true`. With force in prod, **refuse anyway**, because it would duplicate threads (the bot never deletes). Dev allows `week:` override and force. |
| E3 | `/plan` arrives during the scheduled run. | Use a global per-week mutex. The second caller gets "already running". |
| E4 | Week reload while a single-meal action holds a message lock. | The week reload takes all meal locks for the affected meals, or fails fast with "busy, try again". |

---

## 3. Risks

| # | Risk | Likelihood / impact | Mitigation |
|---|---|---|---|
| R1 | **Structured output plus thinking incompatibility.** Forced `tool_choice` has not been allowed with extended thinking. The exact effort/thinking parameter for Haiku 5.5 is unknown. | High / blocks slice 3 | Spike first. Options: (a) native structured outputs (JSON schema response format) if supported with thinking, (b) non-forced tool plus instructions, (c) JSON in text plus zod parse. Zod validation runs in every case. |
| R2 | **Duplicates after a crash mid-posting.** Threads, messages and events created but not recorded. | Medium / messy channel and calendar | Write each created ID to SQLite immediately after creation. On resume: Calendar uses `events.list(privateExtendedProperty=mealKey=…)` to find orphans before creating. For Discord, scan the channel's active threads by name and the thread's bot messages by content prefix and order. Persist "about to create X" markers so the scan only runs when needed. |
| R3 | **Non-idempotent cook flow.** Deduction ran, then Calendar failed; a blind retry would deduct twice. | Medium / wrong inventory | Use an explicit step log per action in SQLite (`meal_actions`: deducted, cooked_appended, calendar_patched, discord_rendered). Resume skips completed steps. needs_attention + `/meal reset` resumes from the log. |
| R4 | **Haiku ledger arithmetic.** 35 recipes sharing inventory; overshoots are likely. | High / retries, cost, failed plans | Give the model a per-ingredient budget table (quantity / days) in the prompt. Validation errors must be precise ("eggs: used 14, have 12, over by 2 at Thu dinner"). Consider a deterministic repair pass that scales the last offending recipe down by ≤20%: a decision. |
| R5 | **Output size and latency.** About 35 recipes in one call means about 15–25k output tokens plus thinking. Could be 1–3 minutes. | Medium | Slash command `deferReply`. Set `max_tokens` with headroom. Use streaming in the SDK to avoid HTTP timeouts. Fallback (decide later): split into two calls (Mon–Wed, Thu–Sun) chaining the ledger. |
| R6 | **Calendar description size.** Three full lunch recipes plus footer may approach the description limit (reportedly about 8 KB; verify). | Low–Med | Measure in fixtures. Truncate notes first, then steps, with "(truncated)". |
| R7 | **GCE ADC scopes.** The VM's default access scopes don't include Sheets/Calendar; ADC returns 403 even with sharing set up. | High on first deploy | Create the VM with `cloud-platform` scope (IAM controls access), or explicit `spreadsheets` and `calendar` scopes. Add this to RUNBOOK. Note: a service account must be granted calendar access by sharing with "Make changes to events"; it doesn't need to "add" the calendar. |
| R8 | **Multi-arch build with `better-sqlite3`.** Native module; arm64 build under QEMU is slow and fragile. | Medium | Build on target architecture or use prebuilt binaries (verify that `better-sqlite3` ships linux-arm64 prebuilds for the chosen Node LTS). Alternative: Node's built-in `node:sqlite` if stable in the chosen LTS, since it has no native build (verify it has a backup API). |
| R9 | **DRY_RUN creates no event IDs and no deductions.** Later reload/cook then "errors loudly" because events are missing. | Certain in dev | DRY_RUN decorators return synthetic IDs (`dry-<uuid>`) and keep an in-memory or SQLite shadow store, so flows complete end to end. |
| R10 | **Snapshot staleness.** Restore happens only when there's no local file; the bucket can lag by the debounce window. | Low | Debounce of about 10 s plus snapshot on SIGTERM. Docker `stop_grace_period` ≥ 15 s. Log the snapshot age on restore. |
| R11 | **Reaction event storms / rate limits.** Placing about 50 reactions at posting is slow (reaction endpoints are tightly rate-limited). | Low | discord.js queues it. Posting takes about 30–60 s, which is acceptable. Don't parallelize per channel. |
| R12 | **Guardrail removal loops.** The bot removes a reaction, which produces a remove event. | Low | Only handle `reactionAdd`. Ignore `reactionRemove` entirely. |
| R13 | **Secrets: env vars vs Secret Manager.** Two sources, unclear precedence. | Low | Prod: `SECRETS_SOURCE=gsm` fetches named secrets at startup into the same zod-validated config object. Dev: `.env`. Env always wins for local overrides. |
| R14 | **Prompt injection via sheet text.** Low (family-only sheet). | Low | The sheet content is treated as data in the prompt. Outputs are validated. No tools. Acceptable. |
| R15 | **Cost runaway.** | Low | Max 3 calls per action, global reload limit 10/h, Anthropic key spend limit, plus a daily Claude-call counter in `kv` with a hard cap (for example 50/day). |

---

## 4. Missing decisions (checklist for the owner)

1. Definition of active/current week around Sunday evening (A1).
2. Recovery: `/meal reset`, or SQLite hand edits only (E1)?
3. Behavior when the planner can't produce a feasible week: fail, or allow "skip" meals (P2)?
4. Deterministic ledger repair, or retries only (R4)?
5. Cooked tab: add `planned_date` column? Cook date semantics (S2)?
6. Add common fats/spices to `assumed_staples` (S7)?
7. Language semantics (D8).
8. Allowed user IDs: a list, not exactly two (env `ALLOWED_USER_IDS=comma,separated`)?
9. SQLite driver: `better-sqlite3` vs `node:sqlite` (R8). Snapshot via GCS backup API vs Litestream (recommend the self-managed GCS snapshot for MVP; Litestream adds a sidecar).
10. Who receives errors besides the thread? (Optional: DM to the owner.)
11. Exact Haiku 5.5 model ID and thinking/effort parameter, and the structured-output method (R1).
12. Daily Claude-call hard cap value (R15).
13. Does `/plan` in prod accept a week override (recommend no)?
14. Does "Updating..." apply to the intro message during week reload (recommend yes, plus each affected meal)?

---

## 5. Proposed repository layout

```
meal-disc/
├─ AGENTS.md                    # conventions for opencode: commands, layout, test rules, "never call real APIs in tests"
├─ package.json  tsconfig.json  vitest.config.ts  eslint/prettier config
├─ Dockerfile  docker-compose.yml  .dockerignore  .env.example
├─ docs/
│  ├─ SPECS.md  PLAN.md  RUNBOOK.md  E2E_CHECKLIST.md  DECISIONS.md
├─ src/
│  ├─ main.ts                   # composition root: config → clients → flows → discord listeners → scheduler
│  ├─ config/
│  │  ├─ env.ts                 # zod schema for env (APP_ENV, DRY_RUN, IDs, model, bucket…)
│  │  ├─ secrets.ts             # env or Secret Manager loader
│  │  └─ sheetConfig.ts         # Config tab → typed AppSettings with defaults
│  ├─ lib/
│  │  ├─ logger.ts              # pino, redaction, pretty in dev
│  │  ├─ context.ts             # AsyncLocalStorage correlation ID
│  │  ├─ clock.ts  time.ts      # injectable clock; week_id, tz math, date formatting
│  │  ├─ errors.ts              # AppError kinds, fun messages
│  │  ├─ locks.ts               # keyed async mutex (per message, per week)
│  │  ├─ rateLimit.ts  retry.ts  debounce.ts
│  ├─ domain/
│  │  ├─ types.ts               # WeekId, Slot, MealKey, Recipe, MealOption, MealStatus…
│  │  ├─ mealState.ts           # pure state machine: (state, event) → (newState, effects)
│  │  ├─ ledger.ts              # pure virtual ledger + validation errors
│  │  ├─ normalize.ts           # names, titles, units
│  │  ├─ emojis.ts              # all emoji constants
│  │  └─ render.ts              # Discord message text, calendar summary/description
│  ├─ clients/
│  │  ├─ sheets/    SheetsClient.ts  GoogleSheetsClient.ts  FakeSheetsClient.ts
│  │  ├─ calendar/  CalendarClient.ts  GoogleCalendarClient.ts  FakeCalendarClient.ts
│  │  ├─ discord/   DiscordGateway.ts  DiscordJsGateway.ts  FakeDiscordGateway.ts
│  │  ├─ llm/       LlmClient.ts  AnthropicLlmClient.ts  FixtureLlmClient.ts  RecordingLlmClient.ts
│  │  ├─ storage/   SnapshotStore.ts  GcsSnapshotStore.ts  FsSnapshotStore.ts
│  │  └─ dryRun.ts              # DRY_RUN decorators for Sheets and Calendar writes
│  ├─ state/
│  │  ├─ db.ts  migrations/     # schema versioned with a user_version pragma
│  │  ├─ repos.ts               # WeekRepo, DayRepo, MealRepo, ActionLogRepo, KvRepo
│  │  └─ snapshot.ts            # backup API → upload (debounced), restore on boot
│  ├─ planner/
│  │  ├─ schema.ts              # zod output schema (+ JSON schema export)
│  │  ├─ prompt.ts              # system + user prompt builders
│  │  ├─ validate.ts            # names, units, banned, duplicates, ledger
│  │  └─ planner.ts             # call → validate → retry ≤2
│  ├─ flows/
│  │  ├─ weeklyPlan.ts          # resumable: planning → posting → complete
│  │  ├─ cook.ts  rate.ts  deduct.ts
│  │  ├─ reloadMeal.ts  reloadWeek.ts
│  ├─ discord/
│  │  ├─ reactionRouter.ts      # bot filter → auth → week/state guardrails → debounce → lock → flow
│  │  └─ commands/  plan.ts  mealReset.ts
│  └─ scheduler/scheduler.ts    # croner 15-min tick → "is planning due?"
└─ test/
   ├─ fixtures/claude/*.json    # recorded requests/responses
   ├─ fixtures/sheets/*.json
   └─ unit + flow tests mirroring src/
```

Principles: `domain/` is pure, with no I/O. `flows/` depend only on interfaces. Only `main.ts` wires real implementations. All time comes from `Clock`.

---

## 6. Client interfaces (design sketches, not implementation)

Shared types: `MealKey = "${weekId}:${date}:${slot}"`, `Slot = "breakfast" | "lunch" | "dinner"`, dates as `YYYY-MM-DD` strings in Config TZ.

### 6.1 SheetsClient (thin, tab-level I/O; no business logic)
```ts
interface SheetsClient {
  readConfig(): Promise<Array<{ key: string; value: string }>>;
  readInventory(): Promise<InventoryRow[]>;          // { rowNumber, name, unit, quantityRaw, quantity: number | null }
  readLiked(): Promise<TitleRow[]>;                  // { rowNumber, title, dateAdded }
  readBanned(): Promise<TitleRow[]>;
  readCooked(): Promise<CookedRow[]>;                // caller filters by date

  updateInventoryQuantities(updates: Array<{
    rowNumber: number; expectedName: string; newQuantity: number;
  }>): Promise<{ applied: number[]; mismatched: number[] }>;   // one batchUpdate; verifies names
  appendCooked(row: NewCookedRow): Promise<{ rowNumber: number }>;
  updateCookedRating(rowNumber: number, expect: { weekId: string; slot: Slot }, rating: "liked" | "disliked"): Promise<void>;
  appendLiked(title: string, date: string): Promise<void>;
  appendBanned(title: string, date: string): Promise<void>;
}
```
Deduction math (match, clamp, deltas) lives in `flows/deduct.ts`. Fake: in-memory tabs with failure injection (`failNext(op)`).

### 6.2 CalendarClient
```ts
interface CalendarClient {
  createEvent(e: MealEventInput): Promise<{ eventId: string }>;
  patchEvent(eventId: string, patch: Partial<Pick<MealEventInput, "summary" | "description" | "start" | "end">>): Promise<void>;
  getEvent(eventId: string): Promise<MealEvent | null>;       // null on 404/410 (deleted)
  findByMealKey(mealKey: string): Promise<MealEvent | null>;  // privateExtendedProperty query; used for crash recovery
}
interface MealEventInput {
  mealKey: string; summary: string; description: string;
  start: string; end: string; timeZone: string;               // local ISO + IANA tz
}
```
Rendering (✅ prefix, " | " join, footer, truncation) lives in `domain/render.ts`.

### 6.3 DiscordGateway (outbound operations plus inbound event stream; hides discord.js)
```ts
interface MessageRef { channelId: string; messageId: string }   // channelId may be a thread
interface DiscordGateway {
  // outbound
  sendMessage(channelId: string, content: string): Promise<MessageRef>;
  createThread(channelId: string, name: string): Promise<{ threadId: string }>;
  ensureThreadOpen(threadId: string): Promise<void>;           // unarchive if needed
  editMessage(ref: MessageRef, content: string): Promise<void>; // calls ensureThreadOpen
  fetchMessage(ref: MessageRef): Promise<{ content: string; reactions: ReactionSummary[] } | null>;
  addReactions(ref: MessageRef, emojis: string[]): Promise<void>;  // sequential
  removeUserReaction(ref: MessageRef, emoji: string, userId: string): Promise<void>;
  removeEmoji(ref: MessageRef, emoji: string): Promise<void>;      // all users
  hasUserReaction(ref: MessageRef, emoji: string, userId: string): Promise<boolean>; // debounce re-check
  findThreadByName(channelId: string, name: string): Promise<string | null>;   // recovery
  // inbound
  onReactionAdd(h: (e: ReactionAddEvent) => Promise<void>): void;
  onSlashCommand(name: string, h: (i: CommandInvocation) => Promise<void>): void;
  readonly botUserId: string;
}
interface ReactionAddEvent { channelId: string; messageId: string; userId: string; emoji: string } // emoji normalized (unicode or "name:id")
interface CommandInvocation { userId: string; options: Record<string, string | boolean | undefined>;
  defer(): Promise<void>; reply(text: string): Promise<void> }
```
The fake records all calls and lets tests emit `ReactionAddEvent`s with a fake clock, for the guardrail and debounce tests.

### 6.4 LlmClient (generic) and Planner (domain)
```ts
interface LlmClient {
  generateJson(req: {
    system: string;
    messages: Array<{ role: "user" | "assistant"; content: string }>;
    jsonSchema: object;                 // derived from zod
    maxTokens: number;
    effort: "none" | "low" | "medium" | "high";  // mapped to the verified API parameter
    purpose: "plan_week" | "reload_meal" | "reload_week";   // for logs and fixture keys
  }): Promise<{ text: string; json: unknown; model: string;
                usage: { inputTokens: number; outputTokens: number; thinkingTokens?: number };
                latencyMs: number }>;
}

interface Planner {
  plan(input: PlannerInput): Promise<PlannerResult>;   // ≤ 3 LLM calls; throws PlanningFailed(errors)
}
interface PlannerInput {
  settings: AppSettings; inventory: InventoryItem[]; banned: string[]; liked: string[];
  recentlyCooked: string[]; existingWeekTitles: string[];
  meals: Array<{ date: string; slot: Slot; options: number }>;
  reserveLunchFirstOption: boolean;      // true for week plans; false for a single-meal reload
}
```
`FixtureLlmClient` keys fixtures by `purpose` plus a hash of the normalized request. `RecordingLlmClient` (dev only) wraps the real client to capture new fixtures.

### 6.5 Other seams
`Clock { now(): Date }`, `SnapshotStore { upload(path), downloadLatest(path): boolean }`, `StateStore` (repos). Flows take a `Deps` object.

---

## 7. Build order: proposed changes to section 15

Mostly agreed. Changes:

1. **Add slice 0: a spike (throwaway, not committed to src).** Verify: the Haiku 5.5 model ID, the effort/thinking parameter, structured output combined with thinking (R1); reactions on archived threads (D6); Calendar SA access and the description size (R6); `better-sqlite3` arm64 prebuilds (R8). Cheap, and it de-risks slices 3, 5 and 10.
2. **Move Calendar before the reaction handler.** The cook flow trims the calendar event; building slice 6 without it means coming back to it later.
3. **Pull a minimal `/plan` (dev only) into the Discord posting slice.** Without a trigger you can't exercise posting in the dev server. The scheduler, catch-up and idempotency polish stay late.
4. **Put the domain state machine and action log in the state slice,** so cook/reload are built against resumable steps from the start (R3).
5. **Add Sheets writes to slice 2,** with the fake and the DRY_RUN decorator. The interfaces stabilize once.

### Revised order
| # | Slice | Done when |
|---|---|---|
| 0 | Spike: verify APIs and parameters, write findings to `docs/DECISIONS.md` | Decisions recorded |
| 1 | Repo, AGENTS.md, env/secrets config, pino + redaction + correlation, Clock/time utils, errors | Unit tests for config, time, redaction |
| 2 | Sheets client: interface, Google implementation, fake, reads and writes, Config parsing with defaults, DRY_RUN decorator | Fake-based tests; one manual read against the dev sheet |
| 3 | Planner: schema, prompt, validation + ledger, retries, LLM client + fixtures | Ledger and validation tests; fixture replay; one recorded real call |
| 4 | SQLite state: migrations, repos, meal state machine, action log, snapshot/restore | State machine + idempotency tests; snapshot round-trip with FsSnapshotStore |
| 5 | Calendar client: create/patch/get/find, render, fake | Render tests; manual create in dev calendar |
| 6 | Weekly flow + Discord posting: intro, threads, messages, reactions, calendar events, resumable `/plan` (dev) | Flow test with all fakes incl. crash/resume; manual run in dev server |
| 7 | Reaction router + cook + deduction + rating | Guardrail, debounce, lock, deduction, partial-failure tests |
| 8 | Reload single meal and week (+ rate limit) | Reload tests incl. missing-artifact errors |
| 9 | Scheduler tick + catch-up, prod `/plan` rules, `/meal reset`, fun errors everywhere, daily cap | Scheduler tests with fake clock incl. DST |
| 10 | Docker multi-arch, VM, Secret Manager, ADC scopes, RUNBOOK, E2E checklist, prod bot | Checklist passes in dev, then prod |

---

## 8. Token cost estimates

### 8.1 Build cost (opencode with Claude Opus 5.5: $4/M input, $20/M output, $0.20/M cache read, $5/M cache write)

Assumptions: one session per slice. Context grows from about 15k to 80k tokens. Most input is cache reads. Output includes code, tests and reasoning. Ranges cover normal debugging; a bad API surprise can double a slice.

| Slice | Turns | Input processed (mostly cached) | Output | Est. cost |
|---|---|---|---|---|
| 0 Spike | 15–25 | 0.4–0.8M | 10–20k | $0.50–1.20 |
| 1 Scaffold/config/logging | 20–35 | 0.6–1.2M | 20–35k | $0.80–1.80 |
| 2 Sheets | 25–40 | 0.8–1.5M | 25–40k | $1.00–2.20 |
| 3 Planner | 40–70 | 1.5–3.0M | 40–70k | $2.00–4.50 |
| 4 SQLite + state machine + snapshot | 30–50 | 1.0–2.0M | 30–50k | $1.40–3.00 |
| 5 Calendar | 20–30 | 0.6–1.0M | 15–25k | $0.70–1.50 |
| 6 Weekly flow + posting | 40–70 | 1.5–3.0M | 40–60k | $2.00–4.20 |
| 7 Reactions + cook + rating | 50–80 | 2.0–3.5M | 50–80k | $2.60–5.20 |
| 8 Reload | 30–50 | 1.0–2.0M | 25–45k | $1.30–2.80 |
| 9 Scheduler/commands/errors | 25–40 | 0.8–1.5M | 20–35k | $1.00–2.10 |
| 10 Deploy/runbook | 20–40 | 0.6–1.2M | 15–30k | $0.70–1.70 |
| **Total** | | **~11–21M** | **~0.3–0.5M** | **~$14–30** |

Cost breakdown: roughly 30% cache reads, 30% cache writes, 40% output. Keep slices in fresh sessions and keep AGENTS.md short to limit context growth. Reloading SPECS.md + PLAN.md each session adds about 8k tokens.

### 8.2 Runtime cost (Haiku 5.5: $0.10/M input, $0.50/M output under 100k context)

| Call | Input | Output (incl. medium thinking) | Cost |
|---|---|---|---|
| Weekly plan, first try (about 35 recipes) | 8–12k | 20–30k | ~$0.011–0.016 |
| Weekly plan, worst case (3 attempts; retries carry the prior output) | ~80k total | ~80k total | ~$0.05 |
| Single-meal reload (lunch, 3 options) | 6–8k | 3–5k | ~$0.002–0.003 |
| Week reload (rest of week) | 8–40k | 10–25k | ~$0.01–0.03 |

A realistic month (4 plans, about 20 meal reloads, 2 week reloads, some retries) is **under $0.50/month**. The spend limit protects against bugs, not normal use. Watch the 100k-context tier: a retry that carries large outputs can cross it and the price becomes 5×. Keep retry messages compact (send errors plus the previous JSON, not the prior thinking).

---

## 9. Next steps
1. The owner answers the section 4 checklist (defaults are proposed inline).
2. Run slice 0 and record the outcomes in `docs/DECISIONS.md`.
3. Update SPECS.md to v2 with the decisions, then start slice 1.
