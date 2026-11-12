# Setup: Google Sheets

Requires: `docs/setup/google-cloud.md` done (you have the service account email).

## 1. Create the dev spreadsheet

1. Open https://sheets.google.com → **Blank spreadsheet**.
2. Name it `dev_Meal Planner`.
3. Create five tabs (bottom bar, **+**). The names are exact and case-sensitive:
   `Inventory`, `Cooked`, `Liked`, `Banned`, `Config`.
4. Put these headers in **row 1** of each tab, one per column starting at A:

| Tab | A | B | C | D | E | F |
|---|---|---|---|---|---|---|
| Inventory | name | unit | quantity | | | |
| Cooked | date | week_id | slot | title | rating | inventory_changes |
| Liked | title | date_added | | | | |
| Banned | title | date_added | | | | |
| Config | key | value | | | | |

5. Fill **Config** (one key per row; you can change values any time):

| key | value |
|---|---|
| servings | 4 |
| breakfast_options | 1 |
| lunch_options | 3 |
| dinner_options | 1 |
| breakfast_time | 07:30 |
| lunch_time | 12:00 |
| dinner_time | 18:00 |
| breakfast_minutes | 30 |
| lunch_minutes | 45 |
| dinner_minutes | 60 |
| timezone | America/New_York |
| language | English |
| no_repeat_weeks | 2 |
| assumed_staples | salt, pepper, water, oil |
| reaction_debounce_seconds | 3 |
| plan_day | sunday |
| plan_time | 18:00 |
| catch_up | true |

6. Fill **Inventory** with real items, one per row. Use one unit per row, written the way you want the bot to use it:

| name | unit | quantity |
|---|---|---|
| eggs | units | 12 |
| rice | g | 2000 |
| chicken breast | g | 1500 |
| potatoes | units | 10 |
| milk | ml | 2000 |

   Tips: keep names simple and unique. Quantity must be a plain number (`1.5`, not `1 1/2`). The bot only lowers quantities and never deletes rows.

## 2. Share it with the bot

1. Click **Share** (top right).
2. Paste the service account email (`mealbot-dev@…iam.gserviceaccount.com`).
3. Role: **Editor**. Uncheck "Notify people". Click **Share**.

## 3. Get the spreadsheet ID

The ID is in the URL between `/d/` and `/edit`:
```
https://docs.google.com/spreadsheets/d/1AbCdEfGhIjKlMnOpQrStUvWxYz0123456789/edit
                                      └──────────── this part ────────────┘
```
In `.env`:
```
SHEETS_SPREADSHEET_ID=1AbCdEfGhIjKlMnOpQrStUvWxYz0123456789
```

## 4. Production (later)

Make a copy (**File → Make a copy**) named `Meal Planner`, clear the Cooked/Liked/Banned rows (keep the headers), share it with `mealbot-prod@…`, and put its ID in the prod `.env`.

## Checklist
- [x] Five tabs with exact names and headers
- [x] Config filled
- [x] Inventory has real items
- [x] Shared with the service account as Editor
- [x] ID copied to `.env`
