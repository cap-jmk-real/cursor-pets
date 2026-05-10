import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { defaultPacksDir } from "@cursor-pets/core";

/**
 * Imports Codex-format pet folders from ~/.codex/pets (or CODEX_HOME/pets).
 * Spec: https://raw.githubusercontent.com/openai/skills/main/skills/.curated/hatch-pet/references/codex-pet-contract.md
 *
 * Built-in Codex Desktop mascots ship inside the app bundle (not under ~/.codex/pets).
 * This tool only copies packs you already have on disk (e.g. hatch-pet output or synced pets).
 */

type CodexPetManifest = {
  id?: string;
  displayName?: string;
  description?: string;
  spritesheetPath?: string;
};

/** Row timings derived from OpenAI hatch-pet animation-rows.md (averaged per row). */
const CODEX_ATLAS = {
  columns: 8,
  rows: 9,
  cellWidth: 192,
  cellHeight: 208
} as const;

/** Maps cursor-pets PetStandardState → Codex atlas row + used column span (frameCount). */
const STATE_MAP: Record<
  string,
  { row: number; frameCount: number; frameMs: number }
> = {
  idle: { row: 0, frameCount: 6, frameMs: 217 },
  thinking: { row: 8, frameCount: 6, frameMs: 172 },
  editing: { row: 7, frameCount: 6, frameMs: 157 },
  edited: { row: 0, frameCount: 6, frameMs: 217 },
  running: { row: 7, frameCount: 6, frameMs: 157 },
  ran: { row: 0, frameCount: 6, frameMs: 217 },
  review: { row: 8, frameCount: 6, frameMs: 172 },
  failed: { row: 5, frameCount: 8, frameMs: 145 },
  waiting: { row: 6, frameCount: 6, frameMs: 177 }
};

function codexHome(): string {
  return process.env.CODEX_HOME ?? path.join(os.homedir(), ".codex");
}

function mimeForFile(filePath: string): string {
  const lower = filePath.toLowerCase();
  if (lower.endsWith(".webp")) return "image/webp";
  if (lower.endsWith(".png")) return "image/png";
  return "application/octet-stream";
}

function parseArgs(): { from: string; to: string; dryRun: boolean } {
  const argv = process.argv.slice(2);
  let from = path.join(codexHome(), "pets");
  let to = defaultPacksDir();
  let dryRun = false;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--help" || a === "-h") {
      printHelp();
      process.exit(0);
    }
    if (a === "--dry-run") {
      dryRun = true;
      continue;
    }
    if (a === "--from") {
      from = argv[++i] ?? from;
      continue;
    }
    if (a === "--to") {
      to = argv[++i] ?? to;
      continue;
    }
  }
  return { from, to, dryRun };
}

function printHelp() {
  console.log(`cursor-pets-import-codex — copy Codex-format pets into ~/.cursor-pets/packs

Usage:
  cursor-pets-import-codex [--from <codex-pets-dir>] [--to <packs-dir>] [--dry-run]

Defaults:
  --from   %CODEX_HOME%/pets or ~/.codex/pets
  --to     ~/.cursor-pets/packs (see @cursor-pets/core defaultPacksDir)

Notes:
  - Source folders match Codex's layout: each child folder contains pet.json + spritesheet (webp/png).
  - Built-in Codex Desktop mascot sprites are bundled inside the Codex app; they are not installed
    under ~/.codex/pets unless you add or hatch pets there. This CLI copies only what exists on disk.

Reference:
  https://github.com/openai/skills/blob/main/skills/.curated/hatch-pet/references/codex-pet-contract.md
`);
}

function buildCursorPetsManifest(opts: {
  sourceFolderName: string;
  codex: CodexPetManifest;
  spritesheetFileName: string;
  mime: string;
}) {
  const rawId = opts.codex.id ?? opts.sourceFolderName;
  const id = `codex-${rawId}`.replace(/[^a-zA-Z0-9-_]/g, "-").toLowerCase();
  const displayName = opts.codex.displayName ?? rawId;
  const description =
    opts.codex.description ??
    "Imported from Codex-format folder (8×9 @ 192×208 atlas).";

  return {
    id,
    displayName,
    description,
    author: "cursor-pets-import-codex",
    version: "0.1.0",
    renderers: [
      {
        kind: "sprite",
        spritesheet: {
          path: opts.spritesheetFileName,
          mime: opts.mime
        },
        atlas: {
          columns: CODEX_ATLAS.columns,
          rows: CODEX_ATLAS.rows,
          cellWidth: CODEX_ATLAS.cellWidth,
          cellHeight: CODEX_ATLAS.cellHeight
        },
        animation: {
          states: STATE_MAP
        }
      }
    ]
  };
}

async function pathExists(p: string): Promise<boolean> {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}

async function importOne(opts: {
  srcDir: string;
  destRoot: string;
  dryRun: boolean;
}): Promise<{ ok: boolean; message: string }> {
  const folderName = path.basename(opts.srcDir);
  const petJsonPath = path.join(opts.srcDir, "pet.json");
  if (!(await pathExists(petJsonPath))) {
    return { ok: false, message: `${folderName}: skip (no pet.json)` };
  }

  let raw: string;
  try {
    raw = await fs.readFile(petJsonPath, "utf8");
  } catch (e: any) {
    return { ok: false, message: `${folderName}: cannot read pet.json (${e?.message ?? e})` };
  }

  let codex: CodexPetManifest;
  try {
    codex = JSON.parse(raw) as CodexPetManifest;
  } catch {
    return { ok: false, message: `${folderName}: invalid JSON in pet.json` };
  }

  const sheetName = codex.spritesheetPath ?? "spritesheet.webp";
  const sheetSrc = path.join(opts.srcDir, sheetName);
  if (!(await pathExists(sheetSrc))) {
    const alt = ["spritesheet.webp", "spritesheet.png", "spritesheet.webm"].map((n) =>
      path.join(opts.srcDir, n)
    );
    let found: string | undefined;
    for (const p of alt) {
      if (await pathExists(p)) {
        found = p;
        break;
      }
    }
    if (!found) {
      return {
        ok: false,
        message: `${folderName}: missing spritesheet (${sheetName})`
      };
    }
    Object.assign(codex, { spritesheetPath: path.basename(found) });
  }

  const finalSheetName = codex.spritesheetPath!;
  const mime = mimeForFile(finalSheetName);
  const manifest = buildCursorPetsManifest({
    sourceFolderName: folderName,
    codex,
    spritesheetFileName: finalSheetName,
    mime
  });

  const destDir = path.join(opts.destRoot, manifest.id);

  if (opts.dryRun) {
    return {
      ok: true,
      message: `[dry-run] ${folderName} → ${manifest.id}/ (${finalSheetName})`
    };
  }

  await fs.mkdir(opts.destRoot, { recursive: true });
  await fs.mkdir(destDir, { recursive: true });
  await fs.writeFile(path.join(destDir, "pet.json"), JSON.stringify(manifest, null, 2) + "\n", "utf8");
  await fs.copyFile(path.join(opts.srcDir, finalSheetName), path.join(destDir, finalSheetName));

  return { ok: true, message: `${folderName} → ${manifest.id}/` };
}

async function main() {
  const { from, to, dryRun } = parseArgs();

  if (!(await pathExists(from))) {
    console.error(`Source directory does not exist:\n  ${from}`);
    console.error("\nInstall or hatch Codex pets first, or pass --from path/to/codex/pets");
    process.exit(1);
  }

  const entries = await fs.readdir(from, { withFileTypes: true });
  const dirs = entries.filter((e) => e.isDirectory()).map((e) => path.join(from, e.name));

  if (dirs.length === 0) {
    console.error(`No pet subfolders found under:\n  ${from}`);
    console.error(
      "\nCodex stores custom pets here after packaging (see hatch-pet). Built-in mascots are inside the Codex app."
    );
    process.exit(1);
  }

  console.log(`Importing Codex-format pets\n  from: ${from}\n  to:   ${to}${dryRun ? "\n  (dry run)" : ""}\n`);

  let ok = 0;
  for (const d of dirs) {
    const r = await importOne({ srcDir: d, destRoot: to, dryRun });
    console.log(r.message);
    if (r.ok) ok++;
  }

  console.log(`\nDone. ${ok}/${dirs.length} imported.`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
