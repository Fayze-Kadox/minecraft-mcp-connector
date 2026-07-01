import { writeFileSync, readFileSync, existsSync, mkdirSync, readdirSync } from "node:fs";
import { resolve, join } from "node:path";
import { Vec3 } from "vec3";
import { BotManager } from "../bot/botManager.js";
import type { BlockPlacement } from "../bot/types.js";
import { ToolResult, ok, err } from "../result.js";
import { Coord, Frame, resolveBox, boxVolume } from "../coords.js";
import { botRefFrom } from "../bot/botRef.js";

interface Checkpoint {
  id: string;
  min: Coord;
  max: Coord;
  createdAt: string;
  /** État sauvegardé, ordre yzx, RLE [block, longueur]. */
  palette: string[];
  rle: [number, number][];
}

/** Pile en mémoire des derniers checkpoints (le disque est la persistance). */
const stack: string[] = [];

function ensureDir(dir: string): string {
  const abs = resolve(dir);
  if (!existsSync(abs)) mkdirSync(abs, { recursive: true });
  return abs;
}

// ───────────────────────── SAFE-1 create_checkpoint ──────────────────────

export async function createCheckpoint(
  bm: BotManager,
  dir: string,
  c1: Coord,
  c2: Coord,
  frame: Frame,
  id?: string
): Promise<ToolResult> {
  const bot = bm.require();
  const { min, max } = resolveBox(c1, c2, frame, botRefFrom(bot));
  const vol = boxVolume(min, max);
  if (vol > 500_000) return err(`Zone trop grande pour un checkpoint (${vol} blocs). Limite ~500 000.`);
  await bm.ensureLoaded({ x: (min.x + max.x) >> 1, y: (min.y + max.y) >> 1, z: (min.z + max.z) >> 1 });

  const palette: string[] = [];
  const idx = new Map<string, number>();
  const idOf = (n: string) => {
    let i = idx.get(n);
    if (i === undefined) { i = palette.length; palette.push(n); idx.set(n, i); }
    return i;
  };
  const rle: [number, number][] = [];
  let cur = -1, len = 0;
  for (let y = min.y; y <= max.y; y++)
    for (let z = min.z; z <= max.z; z++)
      for (let x = min.x; x <= max.x; x++) {
        const b = bot.blockAt(new Vec3(x, y, z));
        const id2 = idOf(b ? b.name : "air");
        if (id2 === cur) len++;
        else { if (cur >= 0) rle.push([cur, len]); cur = id2; len = 1; }
      }
  if (cur >= 0) rle.push([cur, len]);

  const cpId = id ?? `cp_${Date.now()}`;
  const cp: Checkpoint = { id: cpId, min, max, createdAt: new Date().toISOString(), palette, rle };
  const abs = ensureDir(dir);
  writeFileSync(join(abs, `${cpId}.json`), JSON.stringify(cp), "utf8");
  stack.push(cpId);
  return ok(`Checkpoint "${cpId}" créé (${vol} blocs sauvegardés). undo restaurera cet état.`, {
    id: cpId, volume: vol, min, max,
  });
}

// ───────────────────────── SAFE-2 undo ───────────────────────────────────

function expand(cp: Checkpoint): BlockPlacement[] {
  const out: BlockPlacement[] = [];
  let ri = 0, rem = cp.rle[0]?.[1] ?? 0, sym = cp.rle[0]?.[0] ?? 0;
  const next = () => {
    rem--;
    while (rem <= 0 && ri + 1 < cp.rle.length) { ri++; sym = cp.rle[ri][0]; rem = cp.rle[ri][1]; }
  };
  for (let y = cp.min.y; y <= cp.max.y; y++)
    for (let z = cp.min.z; z <= cp.max.z; z++)
      for (let x = cp.min.x; x <= cp.max.x; x++) {
        out.push({ pos: { x, y, z }, type: cp.palette[sym] ?? "air" });
        next();
      }
  return out;
}

export async function undo(
  bm: BotManager,
  dir: string,
  backend: any,
  id?: string,
  shouldCancel?: () => boolean
): Promise<ToolResult> {
  const abs = resolve(dir);
  let cpId = id ?? stack[stack.length - 1];
  if (!cpId) {
    const files = existsSync(abs) ? readdirSync(abs).filter((f) => f.endsWith(".json")) : [];
    if (!files.length) return err("Aucun checkpoint à annuler. Crée d'abord un checkpoint avant un build risqué.");
    cpId = files.sort().pop()!.replace(/\.json$/, "");
  }
  const file = join(abs, `${cpId}.json`);
  if (!existsSync(file)) return err(`Checkpoint "${cpId}" introuvable.`);

  const cp = JSON.parse(readFileSync(file, "utf8")) as Checkpoint;
  const placements = expand(cp);
  const outcome = await bm.placeBlocks(placements, { backend, shouldCancel });
  const i = stack.indexOf(cpId);
  if (i >= 0) stack.splice(i, 1);
  return ok(`Checkpoint "${cpId}" restauré (${outcome.placed}/${outcome.requested} blocs).`, {
    id: cpId, restored: outcome.placed, failures: outcome.failures.length,
  });
}
