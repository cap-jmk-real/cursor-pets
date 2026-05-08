export type PetStandardState =
  | "idle"
  | "thinking"
  | "editing"
  | "edited"
  | "running"
  | "ran"
  | "review"
  | "failed"
  | "waiting";

export type PetRendererKind = "ascii" | "sprite";

export type PetPackId = string;

export interface PetPackMetadata {
  id: PetPackId;
  displayName: string;
  description?: string;
  author?: string;
  version?: string;
}

export interface AsciiStateDef {
  frames: string[];
  frameMs?: number;
}

export interface AsciiRendererDef {
  kind: "ascii";
  frameMs?: number;
  states: Partial<Record<PetStandardState, AsciiStateDef>>;
}

export interface SpritesheetDef {
  path: string;
  mime?: "image/webp" | "image/png" | "image/svg+xml";
}

export interface SpriteAtlasDef {
  columns: number;
  rows: number;
  cellWidth: number;
  cellHeight: number;
}

export interface SpriteStateDef {
  row: number;
  frameCount?: number;
  frameMs?: number;
  lastFrameMs?: number;
  slowdown?: number;
}

export interface SpriteAnimationDef {
  autoDetectFrames?: boolean;
  idleSlowdown?: number;
  states: Partial<Record<PetStandardState, SpriteStateDef>>;
  chains?: Record<
    string,
    | string[]
    | {
        mode?: "idleFallback" | "loop" | "once";
        sequence: string[];
      }
  >;
  events?: Record<string, string>;
}

export interface SpriteRendererDef {
  kind: "sprite";
  spritesheet: SpritesheetDef;
  atlas: SpriteAtlasDef;
  animation?: SpriteAnimationDef;
}

export type PetRendererDef = AsciiRendererDef | SpriteRendererDef;

export interface PetPackManifest extends PetPackMetadata {
  renderers: PetRendererDef[];
}

export interface PetState {
  version: 1;
  selectedPetId: PetPackId;
  selectedRendererKind: PetRendererKind;
  currentState: PetStandardState;
  lastActivityAt: string;
  energy?: number;
  stats?: Record<string, number>;
}

