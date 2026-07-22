# XO Features

This file is the source of truth for user-visible capabilities. Whenever XO gains a new feature or
an existing feature changes behavior, update this file in the same change.

## Maintenance Rule

- Update this file whenever the agent gains, removes, or changes a user-visible capability.
- Keep entries factual and current.
- Cross-check `Permissions.md` whenever a feature uses data, credentials, external APIs, tools, or
  privileged local access.

## Current Features

### Desktop Shell

- Runs as a Tauri desktop application with a React and TypeScript frontend.
- Keeps privileged operations in the local Tauri backend instead of the browser bundle.

### Chat

- Supports creating and continuing multiple local chats.
- Stores conversations and messages in a local SQLite database owned by the app.
- Sends chat prompts to the OpenAI Responses API through the Tauri backend.
- Includes recent current-chat history and a compact slice of prior conversations in model context.

### Tool-Aware Chat Context

- Detects simple calendar-related requests and attaches Google Calendar context to the model prompt.
- Detects simple Gmail/mail-related requests and attaches limited Gmail context to the model prompt.
- The model can analyze tool data but cannot currently modify external data.

### Google Calendar Integration

- Lets the user paste a Google Desktop OAuth Client ID and Client Secret.
- Connects Google Calendar through OAuth in the browser with a local loopback callback.
- Shows connection status and account email.
- Can list up to 20 upcoming calendar events for the next 1-31 days.
- The chat can analyze upcoming calendar events when the user asks about calendar, meetings, terms,
  events, or day planning.

### Gmail Integration

- Uses the same Google OAuth client configuration as Calendar, but stores separate Gmail tokens.
- Connects Gmail through a separate OAuth consent flow.
- Can list up to 20 recent Gmail messages, including spam and trash.
- Fetches only message metadata and snippets for the current MVP.
- The chat can analyze recent Gmail messages when the user asks about mail, Gmail, inbox, spam, or
  messages.
- Shows detailed Google API error diagnostics for Gmail failures, including common 403 causes such
  as disabled API access or insufficient OAuth scopes.

### Voice

- Provides local browser microphone recording controls.
- Uses local speech-to-text support for Polish transcription.
- Lets the user insert the latest transcript into the chat prompt.

### Memory View

- Provides a first `Pamiec` workspace tab.
- Shows the planned memory categories:
  - user facts and preferences,
  - conversation memory,
  - tool-derived memory,
  - control and privacy rules.
- Does not yet provide editable structured memory records.
