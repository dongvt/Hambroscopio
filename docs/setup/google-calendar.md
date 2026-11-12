# Setup: Google Calendar

Requires: `docs/setup/google-cloud.md` done (you have the service account email).

## 1. Create the dev calendar

1. Open https://calendar.google.com on a computer (the phone app can't create calendars).
2. Left sidebar → **Other calendars → +** → **Create new calendar**.
3. Name: `Meals (dev)`. Time zone: **(GMT-05:00) Eastern Time - New York**. Click **Create calendar**.

## 2. Share it with the bot

1. Left sidebar → hover `Meals (dev)` → **⋮ → Settings and sharing**.
2. **Share with specific people or groups → Add people and groups**.
3. Paste the service account email (`mealbot-dev@…iam.gserviceaccount.com`).
4. Permission: **Make changes to events**. Click **Send**.
   (Google may say it can't send an email to that address. That's fine.)

## 3. Get the calendar ID

1. Same settings page → scroll to **Integrate calendar**.
2. Copy **Calendar ID**. It looks like `abc123...@group.calendar.google.com`.
3. In `.env`:
   ```
   CALENDAR_ID=abc123...@group.calendar.google.com
   ```

Don't use your primary calendar (your email address) for dev. The bot would write test events into your real calendar.

## 4. Production (later)

Create `Meals` the same way. Share it with `mealbot-prod@…` (**Make changes to events**) and with family members (at least **See all event details**). Put its ID in the prod `.env`.

## Checklist
- [ ] `Meals (dev)` calendar created in the New York time zone
- [ ] Shared with the service account ("Make changes to events")
- [ ] Calendar ID copied to `.env`
