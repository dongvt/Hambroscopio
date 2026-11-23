# End-to-End Dev Checklist

Use the private dev channel, dev sheet and dev calendar. Do not run this checklist against production resources.

## Preconditions

- [x] Dev account setup is complete:
  - [x] [Google Cloud](./setup/google-cloud.md)
  - [x] [Google Sheets](./setup/google-sheets.md)
  - [x] [Google Calendar](./setup/google-calendar.md)
  - [x] [Discord](./setup/discord.md)
  - [x] [Anthropic](./setup/anthropic.md)
- [x] `.env` uses `APP_ENV=dev`.
- [x] `DRY_RUN=false` unless intentionally testing write suppression.
- [x] ADC points to the dev service account.
- [x] Inventory has enough usable items for 21 meals.
- [x] Config uses a timezone and plan time that are convenient for testing.
- [x] A fresh SQLite database is used, or state for the test week is known.

## Automated checks

- [x] `npm run check:sheets` succeeds.
- [x] `npm run check:calendar` creates and patches an event in the dev calendar.
- [x] `npm run check:planner` succeeds for the dev sheet.
- [x] `npm test` passes.
- [x] `npm run typecheck` passes.
- [x] `npm run lint` passes.
- [x] `npm run format:check` passes.
- [x] `npm run build` passes.

## Start and scheduler

- [ ] Build and start the bot.
- [ ] Logs show startup with no secret values.
- [ ] Set `catch_up=false`; restart and confirm no catch-up plan runs outside the due test.
- [ ] Set `catch_up=true`; restart at or after the configured due time and confirm one upcoming week is planned.
- [ ] Wait for a 15-minute scheduler tick outside the due time and confirm no duplicate plan is created.
- [ ] Confirm a complete upcoming week is skipped.

## `/plan`

- [x] Run `/plan` as an allowed user.
- [x] Bot defers and posts a completion reply.
- [x] An unauthorized user receives the access denial.
- [x] Dev `/plan week:<YYYY-MM-DD>` creates the chosen Monday week.
- [x] Exactly 21 meals are saved and posted.
- [x] Exactly 7 public day threads are created.
- [x] The intro is posted in the meal channel with 🔄.
- [x] Breakfast, lunch and dinner messages match Config option counts.
- [x] Calendar events exist for all 21 meals.
- [x] Calendar event summaries and descriptions contain the expected status and recipe details.

## Cook and rate

- [x] React to a lunch option with that option's emoji.
- [x] Message briefly shows `Updating...`.
- [x] Inventory quantities decrease in the sheet.
- [x] A Cooked row is appended with date, week, slot, title and inventory changes.
- [x] Calendar event is trimmed to the chosen meal and marked Cooked.
- [x] Discord message is marked Cooked and swapped to 👍 👎.
- [x] 👍 appends or deduplicates in Liked and updates the Cooked rating.
- [x] 👎 appends or deduplicates in Banned and updates the Cooked rating.
- [x] Rating reactions are removed after the rating is saved.
- [x] Unauthorized emoji and user reactions are removed.

## Reload meal

- [x] React 🔄 on a future planned meal.
- [x] The meal is replanned using current inventory.
- [x] The existing Discord message and Calendar event are updated, not duplicated.
- [x] The reacting user's 🔄 is removed after success.
- [x] The meal reload has no lunch reservation for another first-option meal.
- [x] Repeated reloads do not return duplicate titles from the current week.
- [x] Reloading a past or already cooked meal is rejected or leaves it unchanged.
- [x] Missing Discord message, thread or Calendar event fails loudly and does not create replacements.

## Reload week

- [x] React 🔄 on the current-week intro.
- [x] Wednesday 15:00 style test reloads Wednesday dinner onward through Sunday.
- [x] Breakfast and lunch meals earlier than now are untouched.
- [x] Cooked or rated meals are untouched.
- [x] Existing artifacts are edited in place.
- [x] The intro reacting user's 🔄 is removed after success.
- [x] A single-meal reaction already locked while intro reload starts causes a fast busy warning.

## Rate limit

- [ ] Ten reload actions can be accepted within an hour.
- [ ] The eleventh reload within the rolling hour is rejected with a clear warning.
- [ ] The limit resets after an hour.
- [ ] Restarting the bot preserves the reload rate state.

## Failure and recovery

- [ ] A sheet/API failure marks the relevant meal `needs_attention` where applicable.
- [ ] Discord posts a warning containing a correlation ID.
- [ ] Logs contain the linked stack and operation details.
- [ ] Interrupted `planning` or `posting` state is warned on startup.
- [ ] `/plan` reruns planning when the interrupted status is `planning` and no complete meal plan was saved.
- [ ] `/plan` resumes posting a fully saved plan without duplicating artifacts.
- [ ] For a complete week, delete a day thread in dev and run `/plan`; the thread/messages are restored without replanning or duplicating Calendar events.
- [ ] `/plan` clearly refuses an incomplete saved plan in `posting` state.
- [ ] SQLite backup is taken before any manual repair.

## Restart

- [x] Stop with `Ctrl-C`.
- [x] Restart in dev mode.
- [x] Scheduler resumes.
- [x] Existing complete weeks remain complete.
- [x] Existing meal state and reload rate state survive restart.

## Sign-off

- [x] Dev calendar contains only test events or is cleaned up.
- [x] No `.env` or `.sqlite` file was committed.
- [x] Debug logs do not leave the computer.
- [x] All expected user-facing behavior passed.
