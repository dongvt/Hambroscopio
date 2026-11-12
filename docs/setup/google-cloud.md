# Setup: Google Cloud project and service account

Do this before the Sheets and Calendar guides. The Sheets and Calendar APIs need a Google Cloud project even though we run on this computer. The project is free. No billing is needed for these APIs at our usage.

The bot logs in as a **service account**, a robot Google account with its own email address. You share the spreadsheet and the calendar with that email, the same way you'd share them with a person.

## 1. Create a project

1. Open https://console.cloud.google.com/ and sign in with the Google account that owns the family sheet and calendar.
2. Top bar → project picker → **New project**.
3. Name: `mealbot`. Click **Create**, then select the project in the picker.

## 2. Enable the APIs

1. Go to **APIs & Services → Library**.
2. Search **Google Sheets API** → **Enable**.
3. Search **Google Calendar API** → **Enable**.

## 3. Create the service account

1. Go to **IAM & Admin → Service Accounts → Create service account**.
2. Name: `mealbot-dev`. Click **Create and continue**.
3. Skip "Grant this service account access to project" (no roles needed). Click **Done**.
4. Copy the service account email. It looks like `mealbot-dev@mealbot-123456.iam.gserviceaccount.com`. You'll paste it in the Sheets and Calendar guides.

## 4. Create a JSON key

1. Click the service account → **Keys** tab → **Add key → Create new key → JSON → Create**.
2. A `.json` file downloads. It's a password: never commit it or share it.
3. Move it into the project:
   ```
   mkdir -p ~/dev/meal-disc/secrets
   mv ~/Downloads/mealbot-*.json ~/dev/meal-disc/secrets/google-dev.json
   chmod 600 ~/dev/meal-disc/secrets/google-dev.json
   ```
4. In `.env`:
   ```
   GOOGLE_APPLICATION_CREDENTIALS=./secrets/google-dev.json
   ```

If key creation is blocked ("Service account key creation is disabled"), your account belongs to a Google Workspace organization with that policy turned on. Use a personal Gmail account for the project, or ask the Workspace admin to allow keys for this project.

## 5. Production (later)

Repeat steps 3–4 with `mealbot-prod`, saved as `secrets/google-prod.json`. Use separate accounts so the dev bot can never touch the prod sheet.

## Checklist
- [x] Project created
- [x] Sheets API and Calendar API enabled
- [x] Service account email copied
- [ ] Key saved to `secrets/google-dev.json`
