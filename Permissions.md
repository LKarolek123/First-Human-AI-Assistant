# XO Permissions

This file is the source of truth for what XO can access and what it is allowed to do. Whenever the
agent gains a new permission, tool, credential, data source, external API, or action capability,
update this file in the same change.

## Maintenance Rule

- Update this file whenever XO gains, removes, or changes access to user data, credentials, local
  files, external APIs, tools, or automation.
- Keep read access, write access, and destructive/action permissions separate.
- Prefer least privilege by default.
- If a capability can affect user data outside XO, document the required user confirmation.

## Current Permission Model

### Local Application Data

- XO can read and write its local SQLite database in the Tauri app data directory.
- The database stores chat conversations, messages, plugin connection metadata, and plugin settings.
- The database does not intentionally store Google OAuth access tokens or refresh tokens.

### OpenAI API

- XO can send model requests to the OpenAI Responses API from the Tauri backend.
- The OpenAI API key is read from local environment configuration.
- The OpenAI API key is not bundled into the React frontend.
- Model context may include:
  - current user prompt,
  - recent chat history,
  - compact prior conversation memory,
  - selected Google Calendar event summaries,
  - selected Gmail metadata and snippets.

### Google OAuth Credentials

- XO can store a user-provided Google Desktop OAuth Client ID in local plugin settings.
- XO can store a user-provided Google Desktop Client Secret in the operating system credential
  store.
- Google OAuth tokens are stored through the operating system credential store, not in the React
  bundle and not in the SQLite chat database.
- Calendar and Gmail tokens are stored under separate credential entries.

### Google Calendar

- OAuth scopes:
  - `openid`
  - `email`
  - `profile`
  - `https://www.googleapis.com/auth/calendar.events.readonly`
- XO can read up to 20 upcoming events from the user's primary calendar.
- XO cannot create, update, delete, accept, decline, or invite attendees to calendar events.
- Chat may receive calendar event summaries only when the user's prompt appears calendar-related.

### Gmail

- OAuth scopes:
  - `openid`
  - `email`
  - `profile`
  - `https://www.googleapis.com/auth/gmail.readonly`
- XO can read up to 20 recent Gmail message metadata/snippets.
- XO requests Gmail results with `includeSpamTrash=true`.
- XO cannot send, draft, delete, archive, label, mark as read, or modify email.
- Chat may receive Gmail metadata/snippets only when the user's prompt appears mail-related.

### Voice And Microphone

- XO can request microphone access through the browser runtime when the user uses voice recording.
- Audio is used for local transcription in the current app flow.
- Voice transcript text can be inserted into a chat prompt by the user.

### Not Currently Allowed

- No filesystem management outside the app workspace/data paths.
- No terminal or shell execution from inside XO.
- No autonomous daily Gmail scan yet.
- No push notifications or urgent alert delivery yet.
- No calendar writes.
- No Gmail writes.
- No automatic structured memory writes beyond chat history storage.

