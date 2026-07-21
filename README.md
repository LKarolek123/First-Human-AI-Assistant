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

## Product Priority

1. User wellbeing
2. Privacy
3. Speed
4. Convenience
5. Automation
6. Visual polish

See [docs/vision.md](docs/vision.md), [docs/roadmap.md](docs/roadmap.md), and [docs/architecture.md](docs/architecture.md).

