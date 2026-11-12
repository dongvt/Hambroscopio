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

## 4. Impersonate the service account locally (no key files)

The code uses Application Default Credentials (ADC). Locally, ADC is your own gcloud login acting as the service account. No key is downloaded.

1. Let your user mint tokens for the service account (once per service account):
   ```
   gcloud iam service-accounts add-iam-policy-binding <SA email> \
     --member="user:<your email>" \
     --role="roles/iam.serviceAccountTokenCreator"
   ```
2. Enable the IAM Service Account Credentials API in the service account's project (once):
   ```
   gcloud services enable iamcredentials.googleapis.com --project=<project id>
   ```
3. Create the local ADC file:
   ```
   gcloud auth application-default login --impersonate-service-account=<SA email>
   ```
   This writes `~/.config/gcloud/application_default_credentials.json`. Nothing goes in `.env`.
4. Check it: `npm run check:sheets` (after the Sheets guide).

To switch between dev and prod locally, re-run step 3 with the other service account. The role binding (step 1) can take a minute or two to take effect.

On a GCP VM (later), ADC is the VM's attached service account. The VM needs the `cloud-platform` access scope.

## 5. Production (later)

Repeat steps 3–4 with `mealbot-prod`. Use separate accounts so the dev bot can never touch the prod sheet.

## Checklist
- [x] Project created
- [x] Sheets API and Calendar API enabled
- [x] Service account email copied
- [x] Token Creator role granted to your user on the service account
- [x] IAM Service Account Credentials API enabled
- [x] `gcloud auth application-default login --impersonate-service-account=...` done
