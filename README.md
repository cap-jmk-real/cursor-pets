# Cursor Pets

Cursor Desktop extension + optional floating companion app + Cursor CLI status-line pet.

## What’s in here

- `packages/core`: shared pet-pack + state contract
- `packages/extension`: Cursor Desktop (VS Code) extension (sidebar pet view)
- `packages/cli`: Cursor CLI status-line renderer command
- `packages/companion`: optional floating widget (Electron)
- `examples/packs`: sample pet packs (ASCII + spritesheet-ready)
- `.cursor/hooks.json` + `.cursor/hooks/`: optional hooks to update pet state from agent events

## Pet without the sidebar title bar

Cursor **cannot remove** the title row on a sidebar view (“Cursor Pets”) — that chrome is drawn by the editor, not your HTML.

For **only the pet** (frameless window, no that bar), use the **floating companion**:

- From the command palette: **`Cursor Pets: Open Floating Pet (no title bar)`**  
  (workspace must be this repo so `packages/companion` exists), or
- From a terminal: `npm run -w @cursor-pets/companion start`

Companion UX:

- **Resize** the window by dragging edges (default ~400×220; position/size are remembered).
- **Drag** the pet area by grabbing empty space (see hint bar).
- **☰ Menu** or **right‑click** opens a **native OS menu** (not clipped like HTML menus).

## Quick start (extension)

1. Install deps

```bash
npm install
```

2. Build everything

```bash
npm run build
```

3. Run the extension in an Extension Development Host

- Open this repo in Cursor
- Run `Run > Start Debugging` (VS Code extension workflow)
- In the dev host, open **Cursor Pets** view in the sidebar

## Pet packs

Pet packs are folders containing a `pet.json` and assets. See `examples/packs/`.

For local development, copy a pack into your user packs directory:

- Windows: `%USERPROFILE%\\.cursor-pets\\packs\\`
- macOS/Linux: `~/.cursor-pets/packs/`

## License

MIT

## Optional: enable Cursor hooks (pet reacts to agent activity)

This repo includes a hook script at `.cursor/hooks/pet-state-hook.mjs`, but **hooks are disabled by default** to avoid noise.

To enable:

- Copy `.cursor/hooks.example.json` to `.cursor/hooks.json` (overwrite).

