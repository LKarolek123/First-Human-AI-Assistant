# XO Architecture

## Stack

- Desktop shell: Tauri
- Frontend: React + TypeScript + Vite
- Local storage: SQLite
- AI provider: OpenAI API through a local command boundary
- Plugin model: capability modules with explicit permissions

## Suggested Directory Shape

```text
src/
  app/
  assistant/
  memory/
  plugins/
  ui/
  voice/
src-tauri/
  src/
    commands/
    memory/
    plugins/
```

The initial scaffold keeps the app simple while the product surface is still forming. As features land, modules should move toward this shape.

## Trust Boundary

Frontend code should request actions. Rust/Tauri commands should own privileged desktop access, local filesystem operations, and plugin execution.

Risky operations need explicit confirmation before execution, especially file deletion, external sending, terminal commands, account actions, or anything that changes user data outside XO.

## Memory Model

Memory is transparent and user-editable. A first SQLite schema should separate:

- conversations
- preferences
- projects
- goals
- people
- habits
- knowledge

Every saved memory should include source, timestamp, confidence, and user visibility.

