# XO - Human First Agent

XO is a next-generation desktop AI assistant built around a Human First philosophy.

It is designed to become a calm, voice-first, local-first operating layer for the user: private by default, useful without being noisy, and able to take computer actions only with clear consent.

## Current State

This repository contains the first Tauri + React + TypeScript foundation:

- Vite React app
- Tauri desktop shell
- linting, formatting, and test scripts
- product vision, roadmap, and architecture notes

## Commands

```bash
npm install
npm run dev
npm run build
npm run lint
npm run test
npm run tauri dev
```

## GPT Feedback

The typing feedback panel calls the OpenAI Responses API from a Tauri backend command, so the API
key does not go into the Vite frontend bundle. For local MVP use, create a `.env.local` file:

```bash
OPENAI_API_KEY=your_api_key
OPENAI_MODEL=gpt-4.1-mini
```

`OPENAI_MODEL` is optional.

## Local Chat Memory

XO stores conversations and messages in a local SQLite database owned by the Tauri app data
directory. The frontend talks to the backend through Tauri commands:

- `list_conversations`
- `get_conversation_messages`
- `send_chat_message`

Every new model request includes recent messages from the current chat plus a compact memory slice
from earlier chats, so a new conversation can still reuse context from previous conversations.
The `Pamiec` workspace tab also lets the user manage explicit memory records. Those records are
stored in the same local SQLite database and are added to future model prompts before raw
cross-conversation recall. Manual records are marked as user-added, with source metadata reserved
for future Gmail, Calendar, and chat-derived memory.

## Google Calendar Plugin

The first plugin backend uses Google OAuth for installed desktop apps with PKCE and a local
`127.0.0.1` callback. In normal use, paste a Google OAuth Desktop Client ID and Desktop Client
Secret into the Google Calendar plugin card and click `Zapisz`, then `Polacz`.

For development, this environment variable is still supported as a fallback:

```bash
GOOGLE_OAUTH_CLIENT_ID=your_google_desktop_oauth_client_id
GOOGLE_OAUTH_CLIENT_SECRET=your_google_desktop_oauth_client_secret
```

This is not a Google API key. Private calendar access requires OAuth, so the user still signs in
with Google and grants consent in the browser. The client secret is stored through the operating
system credential store when entered in the app.

Requested scopes are intentionally narrow for the first version:

- `openid`
- `email`
- `profile`
- `https://www.googleapis.com/auth/calendar.events.readonly`

The frontend only sees connection status, account email, and calendar event summaries. OAuth tokens
are stored through the operating system credential store via the Tauri backend, not in the React
bundle and not in the SQLite chat database.

## Gmail Plugin

Gmail uses the same Google OAuth Desktop Client ID configuration, but it is connected as a separate
plugin with separate stored tokens. The first version is read-only and requests:

- `openid`
- `email`
- `profile`
- `https://www.googleapis.com/auth/gmail.readonly`

The Gmail backend only lists up to 20 recent messages and requests metadata/snippets, including spam
and trash via `includeSpamTrash=true`. It does not send, delete, archive, label, or mark messages as
read. Daily scans, priority classification, and urgent notifications should build on this limited
read-only command rather than broad mailbox access.

## Product Priority

1. User wellbeing
2. Privacy
3. Speed
4. Convenience
5. Automation
6. Visual polish

See [docs/vision.md](docs/vision.md), [docs/roadmap.md](docs/roadmap.md), and [docs/architecture.md](docs/architecture.md).

## Change Discipline

When XO gains or changes user-visible behavior, update [Features.md](Features.md). When XO gains or
changes data access, credentials, tools, APIs, or action permissions, update
[Permissions.md](Permissions.md) in the same change.

