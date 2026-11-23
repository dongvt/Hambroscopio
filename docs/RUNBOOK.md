# Runbook

This runbook covers running the bot locally on this computer.

## Prerequisites

Complete the setup guides and confirm:

- `.env` exists for dev and, when switching to production, `.env.prod` contains valid prod values.
- ADC is configured for the service account that has access to the selected environment's sheet and calendar. Dev and prod use separate service accounts.
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

## Docker

Build the image from the repository root:

```bash
docker build -t hambroscopio .
```

Run with the environment file for the desired environment. `.env` should set
`APP_ENV=dev`; `.env.prod` should set `APP_ENV=prod`. The env file is passed to
Docker, not copied into the image. Mount `data` so SQLite state survives
container replacement:

```bash
docker run -d --name hambroscopio --restart unless-stopped \
  --env-file .env \
  -v "$PWD/data:/app/data" \
  -v "$HOME/.config/gcloud:/home/node/.config/gcloud:ro" \
  hambroscopio
```

The gcloud mount is for local ADC-based development. On a GCE VM, use its
attached service account instead. For production, use `--env-file .env.prod`
and a distinct container name, such as `hambroscopio-prod`. Follow logs with
`docker logs -f hambroscopio`.

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

For a deliberately read-only production planner check, use `ENV_FILE=.env.prod npm run check:planner:prod`. Pass `-- --week=YYYY-MM-DD` to reproduce a specific Monday week, or `-- --meal=YYYY-MM-DD:dinner` to test one meal. This reads production Sheets and sends the data to Anthropic, but does not write to Sheets, Calendar, or Discord; it can make up to three model requests.

The configured environment file selects the spreadsheet and calendar, but Google access is selected separately by ADC. Before dev checks, confirm ADC is impersonating the dev service account; before prod, switch to the prod service account. A Sheets or Calendar 403 usually means the active service account has not been shared on that resource.

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
3. If status is `planning` and no complete meal plan was saved, `/plan` reruns planning.
4. If status is `posting` and all 21 meals were saved, `/plan` resumes posting and reuses saved IDs and existing Discord/Calendar artifacts where possible.
5. If status is `posting` with incomplete meal state, `/plan` refuses to continue; inspect SQLite and logs before repairing state.
6. Restart the bot and run `/plan`.

Do not run `/plan` concurrently with a scheduled run or another `/plan`.

If Discord says the application did not respond, check that the running process was rebuilt and restarted with the intended environment file. At info log level, look for `discord slash command received`, `discord slash command acknowledged`, and `plan command completed`; if the first line is absent, that process did not receive the interaction.
