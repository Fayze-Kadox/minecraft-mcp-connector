import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync } from "node:fs";
import { resolve, join } from "node:path";
import { Vec3 } from "vec3";
import { BotManager } from "../bot/botManager.js";
import type { BlockPlacement } from "../bot/types.js";
import { ToolResult, ok, partial, err, ToolError } from "../result.js";
import { Coord, Frame, resolveCoord } from "../coords.js";
import { botRefFrom } from "../bot/botRef.js";
import { expectedStore } from "../state/expectedStore.js";
import type { Blueprint } from "./types.js";
import { compileBlueprint, sortBottomUp } from "./compile.js";

export { compileBlueprint, sortBottomUp } from "./compile.js";

// ───────────────────────── BP-1 build_blueprint ──────────────────────────

export async function buildBlueprint(
  bm: BotManager,
  bp: Blueprint,
  originArg: Coord,
  frame: Frame,
  opts: { backend?: any; shouldCancel?: () => boolean; onProgress?: (p: any) => void }
): Promise<ToolResult> {
  const origin = resolveCoord(originArg, bp.origin ?? frame, botRefFrom(bm.require()));
  let placements: BlockPlacement[];
  try {
    placements = sortBottomUp(compileBlueprint(bp, origin));
  } catch (e) {
    return err((e as Error).message);
  }
  expectedStore.set(`blueprint:${bp.name}`, placements);
  bm.feedback(`🏗️ Blueprint '${bp.name}' : construction de ${placements.length} blocs…`);
  const outcome = await bm.placeBlocks(placements, opts);
  const data = {
    name: bp.name,
    origin,
    requested: outcome.requested,
    placed: outcome.placed,
    failures: outcome.failures.length,
    cancelled: outcome.cancelled,
  };
  if (outcome.cancelled) {
    bm.feedback(`⛔ Blueprint '${bp.name}' : annulé (${outcome.placed}/${outcome.requested})`);
    return partial(`Blueprint "${bp.name}" annulé à ${outcome.placed}/${outcome.requested}.`, data);
  }
  if (outcome.failures.length) {
    bm.feedback(`⚠️ Blueprint '${bp.name}' : ${outcome.placed}/${outcome.requested} blocs (${outcome.failures.length} manquants)`);
    return partial(
      `Blueprint "${bp.name}" : ${outcome.placed}/${outcome.requested} blocs. ${outcome.failures.length} écarts — lance verify_build + auto_repair.`,
      { ...data, sampleFailures: outcome.failures.slice(0, 10) }
    );
  }
  bm.feedback(`✅ Blueprint '${bp.name}' construit (${outcome.placed} blocs)`);
  return ok(`Blueprint "${bp.name}" construit (${outcome.placed} blocs) depuis (${origin.x},${origin.y},${origin.z}). Lance verify_build pour le rapport de conformité.`, data);
}

// ───────────────────────── BP-2 save / load ──────────────────────────────

function ensureDir(dir: string): string {
  const abs = resolve(dir);
  if (!existsSync(abs)) mkdirSync(abs, { recursive: true });
  return abs;
}

export function saveBlueprint(dir: string, bp: Blueprint): ToolResult {
  if (!bp.name || /[^a-zA-Z0-9_-]/.test(bp.name)) {
    return err(`Nom de blueprint invalide : "${bp.name}". Utilise lettres/chiffres/_/-.`);
  }
  const abs = ensureDir(dir);
  const file = join(abs, `${bp.name}.json`);
  writeFileSync(file, JSON.stringify(bp, null, 2), "utf8");
  return ok(`Blueprint "${bp.name}" sauvegardé.`, { name: bp.name, file });
}

export function loadBlueprint(dir: string, name: string): ToolResult<Blueprint> {
  const file = join(resolve(dir), `${name}.json`);
  if (!existsSync(file)) {
    const avail = existsSync(resolve(dir))
      ? readdirSync(resolve(dir)).filter((f) => f.endsWith(".json")).map((f) => f.replace(/\.json$/, ""))
      : [];
    return err(`Blueprint "${name}" introuvable. Disponibles : ${avail.join(", ") || "(aucun)"}.`) as ToolResult<Blueprint>;
  }
  const bp = JSON.parse(readFileSync(file, "utf8")) as Blueprint;
  return ok(`Blueprint "${name}" chargé.`, bp);
}

export function listBlueprints(dir: string): ToolResult {
  const abs = resolve(dir);
  const names = existsSync(abs)
    ? readdirSync(abs).filter((f) => f.endsWith(".json")).map((f) => f.replace(/\.json$/, ""))
    : [];
  return ok(`${names.length} blueprint(s) enregistré(s).`, { blueprints: names });
}

// ───────────────────────── BP-3 capture_blueprint ────────────────────────

/** Scanne une zone et en produit un blueprint « layers » (copier/coller). */
export async function captureBlueprint(
  bm: BotManager,
  name: string,
  corner1: Coord,
  corner2: Coord,
  frame: Frame,
  includeAir: boolean
): Promise<ToolResult<Blueprint>> {
  const bot = bm.require();
  const ref = botRefFrom(bot);
  const a = resolveCoord(corner1, frame, ref);
  const b = resolveCoord(corner2, frame, ref);
  const min = { x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), z: Math.min(a.z, b.z) };
  const max = { x: Math.max(a.x, b.x), y: Math.max(a.y, b.y), z: Math.max(a.z, b.z) };
  await bm.ensureLoaded({ x: (min.x + max.x) >> 1, y: (min.y + max.y) >> 1, z: (min.z + max.z) >> 1 });

  // Construit une palette compacte symbole→bloc.
  const symbols = "#GDWSEOPQRTUVXYZabcdefghijklmnopqrstuvwxyz0123456789@&%$*+=<>?!".split("");
  const palette: Record<string, string> = {};
  const blockToSym = new Map<string, string>();
  let symIdx = 0;
  const symFor = (block: string): string => {
    if (block === "air") return ".";
    let s = blockToSym.get(block);
    if (!s) {
      if (symIdx >= symbols.length) throw new ToolError("Trop de types de blocs distincts pour la capture.");
      s = symbols[symIdx++];
      blockToSym.set(block, s);
      palette[s] = block;
    }
    return s;
  };

  const layers: Blueprint["layers"] = [];
  for (let y = min.y; y <= max.y; y++) {
    const rows: string[] = [];
    for (let z = min.z; z <= max.z; z++) {
      let row = "";
      for (let x = min.x; x <= max.x; x++) {
        const blk = bot.blockAt(new Vec3(x, y, z));
        const nm = blk ? blk.name : "air";
        if (nm === "air" && !includeAir) { row += "."; continue; }
        row += symFor(nm);
      }
      rows.push(row);
    }
    layers.push({ y: y - min.y, rows });
  }

  const bp: Blueprint = {
    name,
    origin: "relative",
    palette,
    layers,
    meta: { capturedFrom: { min, max }, dims: { x: max.x - min.x + 1, y: max.y - min.y + 1, z: max.z - min.z + 1 } },
  };
  return ok(`Blueprint "${name}" capturé (${Object.keys(palette).length} types). Sauvegarde-le avec save_blueprint pour le réutiliser.`, bp);
}
