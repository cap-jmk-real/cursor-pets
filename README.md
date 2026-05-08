# Cursor Pets

Cursor Desktop extension + optional floating companion app + Cursor CLI status-line pet.

## What’s in here

- `packages/core`: shared pet-pack + state contract
- `packages/extension`: Cursor Desktop (VS Code) extension (sidebar pet view)
- `packages/cli`: Cursor CLI status-line renderer command
- `packages/companion`: optional floating widget (Electron)
- `examples/packs`: sample pet packs (ASCII + spritesheet-ready)
- `.cursor/hooks.json` + `.cursor/hooks/`: optional hooks to update pet state from agent events

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

