# Setup: Discord bot

You'll create a **dev bot** now and a **prod bot** later. Both live in the same family server.

## 1. Turn on Developer Mode (to copy IDs)

Discord app → **User Settings → Advanced → Developer Mode: on**. Now right-click on servers, channels and users shows **Copy ID**.

## 2. Create the application and bot

1. Open https://discord.com/developers/applications → **New Application**.
2. Name: `Mealbot Dev`. Accept the terms → **Create**.
3. **General Information**: copy the **Application ID**.
   ```
   DISCORD_APP_ID=123456789012345678
   ```
4. Left menu → **Bot**:
   - **Reset Token** → copy the token (shown only once). It's a password.
     ```
     DISCORD_TOKEN=MTIz...
     ```
   - **Public Bot: off** (only you can invite it).
   - **Privileged Gateway Intents**: leave all three **off**. The bot doesn't need Message Content, Members or Presence. Reaction and message events are not privileged.

## 3. Invite the bot to the server

1. Left menu → **OAuth2 → URL Generator**.
2. Scopes: check **bot** and **applications.commands**.
3. Bot permissions:
   - View Channels
   - Send Messages
   - Create Public Threads
   - Send Messages in Threads
   - Manage Threads (to unarchive old threads)
   - Read Message History
   - Add Reactions
   - Manage Messages (to remove other people's reactions)
4. Copy the generated URL at the bottom, open it in a browser, pick the family server → **Authorize**.

## 4. Create the dev channel

1. In the server: **+** next to a category → **Create Channel** → Text → name `meals-dev` → turn on **Private Channel** → **Next**.
2. Add yourself and the **Mealbot Dev** bot (search its name under members/roles) → **Create Channel**.
3. Check the bot really has access: channel **⚙ Edit Channel → Permissions** → the bot (or its role) has the permissions listed in step 3. Private channels block everyone not listed, so the bot must be added explicitly.
4. Right-click the channel → **Copy Channel ID**.
   ```
   DISCORD_CHANNEL_ID=234567890123456789
   ```

## 5. Copy the other IDs

- Server: right-click the server icon → **Copy Server ID**.
  ```
  DISCORD_GUILD_ID=345678901234567890
  ```
- Allowed users (you and your partner): right-click each name → **Copy User ID**. Comma-separated, no spaces.
  ```
  ALLOWED_USER_IDS=456789012345678901,567890123456789012
  ```

## 6. Production (later)

Repeat steps 2–4 with an application named `Mealbot` and a private channel named `meals` (add both family members). Use the prod values in the prod `.env`. Keep the dev bot out of the prod channel.

## Checklist
- [x] Developer Mode on
- [x] Application ID and bot token copied
- [x] Bot invited with the listed permissions
- [x] Private `meals-dev` channel with the bot added
- [x] Guild ID, channel ID and allowed user IDs copied
