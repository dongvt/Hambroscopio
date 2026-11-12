# Setup: Anthropic API key (Claude)

Use a key just for the bot, separate from the one opencode uses, so you can see and cap the bot's spending on its own.

## 1. Create a workspace and key

1. Open the Claude Developer Console (https://console.anthropic.com, which may redirect to https://platform.claude.com) and sign in.
2. **Settings → Workspaces → Create workspace**, named `mealbot`. A separate workspace keeps usage and limits apart from opencode.
3. **Settings → API keys → Create key**. Workspace: `mealbot`. Name: `mealbot-dev`.
4. Copy the key (shown only once). It starts with `sk-ant-`.
   ```
   ANTHROPIC_API_KEY=sk-ant-...
   ANTHROPIC_MODEL=claude-haiku-5-5
   ```
   (Slice 3 confirms the exact model ID in the docs and updates `.env.example` if needed.)

## 2. Set a spend limit

1. **Settings → Limits** (or the `mealbot` workspace settings) → set a monthly spend limit, for example **$5**. Normal use is a few cents per week.
2. Make sure the organization has credits or billing set up (**Settings → Billing**), or API calls will fail.

## 3. Monitor

Track usage in **Usage / Cost** in the console, filtered by the `mealbot` workspace. The bot also logs input and output tokens for every call.

## 4. Production (later)

Create a second key, `mealbot-prod`, in the same workspace for the prod `.env`. You can then revoke the dev key without affecting prod.

## Checklist
- [x] `mealbot` workspace created
- [x] Key created and copied to `.env`
- [x] Spend limit set
- [x] Billing/credits active
