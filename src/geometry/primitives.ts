import { BotManager } from "../bot/botManager.js";
import type { Backend, BuildOptions } from "../bot/botManager.js";
import type { BlockPlacement } from "../bot/types.js";
import { ToolResult, ok, partial } from "../result.js";
import { Coord, Frame, resolveCoord, resolveBox } from "../coords.js";
import { botRefFrom } from "../bot/botRef.js";
import { expectedStore } from "../state/expectedStore.js";
import * as shapes from "./shapes.js";
import { Vec3 } from "vec3";

export interface ExecOptions {
  backend?: Backend;
  shouldCancel?: () => boolean;
  onProgress?: BuildOptions["onProgress"];
  /** Si défini, n'enregistre pas l'attendu (utilisé en interne par blueprint). */
  noRecord?: boolean;
}

/** Exécute une liste de poses + enregistre l'attendu pour verify/auto_repair. */
async function run(
  bm: BotManager,
  label: string,
  placements: BlockPlacement[],
  opts: ExecOptions
): Promise<ToolResult> {
  if (!opts.noRecord) expectedStore.set(label, placements);
  const outcome = await bm.placeBlocks(placements, {
    backend: opts.backend,
    shouldCancel: opts.shouldCancel,
    onProgress: opts.onProgress,
  });
  const base = {
    label,
    requested: outcome.requested,
    placed: outcome.placed,
    failures: outcome.failures.length,
    cancelled: outcome.cancelled,
  };
  if (outcome.cancelled) {
    bm.feedback(`⛔ ${label} : annulé (${outcome.placed}/${outcome.requested} blocs)`);
    return partial(`${label} : annulé après ${outcome.placed}/${outcome.requested} blocs.`, base);
  }
  if (outcome.failures.length > 0) {
    bm.feedback(`⚠️ ${label} : ${outcome.placed}/${outcome.requested} blocs (${outcome.failures.length} manquants)`);
    return partial(
      `${label} : ${outcome.placed}/${outcome.requested} blocs posés, ${outcome.failures.length} échecs. ` +
        `Lance verify_build puis auto_repair pour corriger.`,
      { ...base, sampleFailures: outcome.failures.slice(0, 10) }
    );
  }
  bm.feedback(`✅ ${label} : ${outcome.placed} blocs`);
  return ok(`${label} : ${outcome.placed} blocs posés en un appel. Pense à verify_build.`, base);
}

const place = (coords: Coord[], type: string): BlockPlacement[] =>
  coords.map((pos) => ({ pos, type }));

// ───────────────────────── HIGH-1 fill_region ────────────────────────────

export function fillRegion(
  bm: BotManager, c1: Coord, c2: Coord, type: string,
  mode: shapes.FillMode, frame: Frame, opts: ExecOptions
): Promise<ToolResult> {
  const { min, max } = resolveBox(c1, c2, frame, botRefFrom(bm.require()));
  const coords = shapes.fillRegion(min, max, mode);
  return run(bm, `fill_region(${mode})`, place(coords, type), opts);
}

// ───────────────────────── HIGH-2 draw_line ──────────────────────────────

export function drawLine(
  bm: BotManager, p1: Coord, p2: Coord, type: string, frame: Frame, opts: ExecOptions
): Promise<ToolResult> {
  const ref = botRefFrom(bm.require());
  const coords = shapes.drawLine(resolveCoord(p1, frame, ref), resolveCoord(p2, frame, ref));
  return run(bm, "draw_line", place(coords, type), opts);
}

// ───────────────────────── HIGH-3 build_wall ─────────────────────────────

export function buildWall(
  bm: BotManager, origin: Coord, direction: shapes.Direction,
  length: number, height: number, type: string, frame: Frame, opts: ExecOptions
): Promise<ToolResult> {
  const o = resolveCoord(origin, frame, botRefFrom(bm.require()));
  const coords = shapes.buildWall(o, direction, length, height);
  return run(bm, "build_wall", place(coords, type), opts);
}

// ───────────────────────── HIGH-4 build_floor_ceiling ────────────────────

export function buildSurface(
  bm: BotManager, c1: Coord, c2: Coord, type: string, frame: Frame, opts: ExecOptions
): Promise<ToolResult> {
  const ref = botRefFrom(bm.require());
  const a = resolveCoord(c1, frame, ref);
  const b = resolveCoord(c2, frame, ref);
  const coords = shapes.buildSurface(a, b, a.y);
  return run(bm, "build_floor_ceiling", place(coords, type), opts);
}

// ───────────────────────── HIGH-5 build_box ──────────────────────────────

export function buildBox(
  bm: BotManager, c1: Coord, c2: Coord, type: string, frame: Frame,
  options: { floor?: boolean; ceiling?: boolean; openings?: shapes.Opening[]; doorBlock?: string },
  opts: ExecOptions
): Promise<ToolResult> {
  const { min, max } = resolveBox(c1, c2, frame, botRefFrom(bm.require()));
  const { blocks, openingCells } = shapes.buildBox(min, max, options);
  const placements = place(blocks, type);
  // Optionnel : poser une porte sur la 1re ouverture au niveau du sol.
  if (options.doorBlock && openingCells.length) {
    const ground = openingCells.filter((c) => c.y === min.y || c.y === min.y + 1);
    for (const g of ground) placements.push({ pos: g, type: options.doorBlock });
  }
  return run(bm, "build_box", placements, opts);
}

// ───────────────────────── HIGH-6 build_sphere ───────────────────────────

export function buildSphere(
  bm: BotManager, center: Coord, radius: number, type: string,
  hollow: boolean, frame: Frame, opts: ExecOptions
): Promise<ToolResult> {
  const c = resolveCoord(center, frame, botRefFrom(bm.require()));
  const coords = shapes.buildSphere(c, radius, hollow);
  return run(bm, `build_sphere(r=${radius})`, place(coords, type), opts);
}

// ───────────────────────── HIGH-7 build_cylinder ─────────────────────────

export function buildCylinder(
  bm: BotManager, baseCenter: Coord, radius: number, height: number,
  axis: shapes.Axis, type: string, hollow: boolean, frame: Frame, opts: ExecOptions
): Promise<ToolResult> {
  const c = resolveCoord(baseCenter, frame, botRefFrom(bm.require()));
  const coords = shapes.buildCylinder(c, radius, height, axis, hollow);
  return run(bm, "build_cylinder", place(coords, type), opts);
}

// ───────────────────────── HIGH-8 build_pyramid ──────────────────────────

export function buildPyramid(
  bm: BotManager, baseCenter: Coord, baseHalfWidth: number, height: number,
  type: string, hollow: boolean, frame: Frame, opts: ExecOptions
): Promise<ToolResult> {
  const c = resolveCoord(baseCenter, frame, botRefFrom(bm.require()));
  const coords = shapes.buildPyramid(c, baseHalfWidth, height, hollow);
  return run(bm, "build_pyramid", place(coords, type), opts);
}

// ───────────────────────── HIGH-9 build_stairs ───────────────────────────

export function buildStairs(
  bm: BotManager, origin: Coord, direction: shapes.Direction, length: number,
  width: number, fillUnder: boolean, type: string, frame: Frame, opts: ExecOptions
): Promise<ToolResult> {
  const o = resolveCoord(origin, frame, botRefFrom(bm.require()));
  const coords = shapes.buildStairs(o, direction, length, width, fillUnder);
  return run(bm, "build_stairs", place(coords, type), opts);
}

// ───────────────────────── HIGH-10 clear_region ──────────────────────────

export function clearRegion(
  bm: BotManager, c1: Coord, c2: Coord, frame: Frame, opts: ExecOptions
): Promise<ToolResult> {
  const { min, max } = resolveBox(c1, c2, frame, botRefFrom(bm.require()));
  const coords = shapes.fillRegion(min, max, "solid");
  return run(bm, "clear_region", place(coords, "air"), opts);
}

// ───────────────────────── HIGH-11 replace_blocks ────────────────────────

export async function replaceBlocks(
  bm: BotManager, c1: Coord, c2: Coord, oldType: string, newType: string,
  frame: Frame, opts: ExecOptions
): Promise<ToolResult> {
  const bot = bm.require();
  const { min, max } = resolveBox(c1, c2, frame, botRefFrom(bot));
  await bm.ensureLoaded({ x: (min.x + max.x) >> 1, y: (min.y + max.y) >> 1, z: (min.z + max.z) >> 1 });
  const oldShort = oldType.includes(":") ? oldType.split(":")[1] : oldType;
  const targets: Coord[] = [];
  for (let x = min.x; x <= max.x; x++)
    for (let y = min.y; y <= max.y; y++)
      for (let z = min.z; z <= max.z; z++) {
        const b = bot.blockAt(new Vec3(x, y, z));
        if (b && b.name === oldShort) targets.push({ x, y, z });
      }
  if (!targets.length) return ok(`Aucun bloc "${oldShort}" trouvé dans la zone — rien à remplacer.`);
  return run(bm, `replace_blocks(${oldShort}→${newType})`, place(targets, newType), opts);
}
