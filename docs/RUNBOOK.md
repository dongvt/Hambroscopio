# Runbook

This runbook covers running the bot locally on this computer.

## Prerequisites

Complete the setup guides and confirm:

- `.env` exists for dev and, when switching to production, `.env.prod` contains valid prod values.
- ADC is configured for the dev service account.
- The dev Discord bot is in the private dev channel.
- The dev spreadsheet and calendar are shared with the dev service account.
- Node 26 is active: `source ~/.nvm/nvm.sh && nvm use`.

Never print or commit `.env`. It contains the Discord token and Anthropic key.

## Start

Use dev mode for the first week:

```bash
source ~/.nvm/nvm.sh
nvm use
npm run build
npm start
```

To start against production resources:

```bash
npm run build
npm run start:prod
```

`npm run start:prod` loads `.env.prod`. The normal `npm start` loads `.env` for dev.

You can also select the file explicitly:

```bash
npm start -- --dev
npm start -- --prod
ENV_FILE=/absolute/path/to/custom.env npm start
```

For an inline environment override, `APP_ENV=prod npm start` also selects `.env.prod`.

For formatted logs:

```bash
npm run build
npm start 2>&1 | npx pino-pretty
```

The bot starts Discord and the 15-minute scheduler. If `catch_up=true`, it also checks immediately whether the upcoming week is due.

## Stop

Press `Ctrl-C` in the process terminal. This stops the scheduler, Discord gateway and SQLite connection.

## Check configuration before starting

```bash
npm run check:sheets
npm run check:calendar
npm run check:planner
npm test
npm run typecheck
npm run lint
npm run format:check
npm run build
```

`check:planner` makes real Anthropic requests. `check:calendar` creates and patches a real dev-calendar event.

## Logs

Use `LOG_LEVEL=info` for normal operation. Use `LOG_LEVEL=debug` only while investigating; debug logs include planner prompts and model responses.

Look for:

- `scheduled weekly plan started`
- `weekly plan completed`
- `reaction accepted`
- `reaction handler failed`
- `weekly plan failed`
- `scheduled weekly plan is interrupted`
- `planner response rejected by validation`
- `cook flow failed`
- `meal reload update failed`

The Discord warning suffix contains a correlation ID. Search logs for that ID to find the linked operations and stack.

Example:

```bash
npm start 2>&1 | npx pino-pretty
```

## Scheduler behavior

Every 15 minutes, the bot reads Config and calculates the upcoming week. It plans only after the configured `plan_day` and `plan_time`, when no complete plan exists.

Weeks with `planning` or `posting` status are not retried automatically. The bot posts a warning and waits for an allowed user to run `/plan`.

The `/plan` command may specify a week only in dev:

```text
/plan
/plan week:2026-11-23
```

## SQLite

Stop the bot before editing SQLite manually. The database path is `SQLITE_PATH`, default `./data/mealbot-dev.sqlite`.

Set the shell path explicitly when using SQLite commands:

```bash
SQLITE_PATH=./data/mealbot-dev.sqlite
```

To inspect it with the SQLite CLI, if installed:

```bash
sqlite3 "$SQLITE_PATH"
```

Useful read-only queries:

```sql
.tables
SELECT week_id, status, intro_message_id, updated_at FROM weeks ORDER BY week_id;
SELECT week_id, date, thread_id FROM days ORDER BY week_id, date;
SELECT id, week_id, date, slot, status, rating, chosen_index,
       discord_message_id, calendar_event_id, cooked_sheet_row, needs_attention
FROM meals
ORDER BY week_id, date, slot;
SELECT key, value FROM kv;
```

Create a backup before a manual repair:

```bash
mkdir -p backups
cp data/mealbot-dev.sqlite "backups/mealbot-dev-$(date +%Y%m%d-%H%M%S).sqlite"
```

If the SQLite CLI is not installed, use the repository's Node dependency:

```bash
node -e 'import("better-sqlite3").then(({default:Database}) => { const db = new Database("./data/mealbot-dev.sqlite", {readonly:true}); console.log(db.prepare("SELECT week_id,status FROM weeks").all()); db.close(); })'
```

Do not delete rows or edit `options_json` unless the intent is clear. Use the smallest update needed.

For an interrupted meal or week, prefer:

1. Stop the bot.
2. Confirm the external Discord and Calendar artifacts are or are not present.
3. Restore the smallest correct state in SQLite.
4. Restart the bot.
5. Run `/plan` if the weekly state is interrupted.

Example reset of a needs-attention meal back to planned:

```sql
UPDATE meals
SET status = 'planned',
    rating = NULL,
    chosen_index = NULL,
    needs_attention = 0,
    updated_at = strftime('%Y-%m-%dT%H:%M:%SZ', 'now')
WHERE id = '<week_id>:<date>:<slot>';
```

Only use this when the meal's Discord and Calendar records remain valid and no cooked inventory or Cooked-sheet operation should be reversed.

## Interrupted run recovery

For `weeks.status='planning'` or `weeks.status='posting'`:

1. Inspect logs and warning correlation IDs.
2. Check whether threads/messages/events exist.
3. The weekly flow reuses saved IDs and existing Discord/Calendar artifacts where possible.
4. Restart the bot.
5. Run `/plan` for the interrupted week.

Do not run `/plan` concurrently with a scheduled run or another `/plan`.
