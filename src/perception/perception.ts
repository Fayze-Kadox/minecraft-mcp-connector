import { Vec3 } from "vec3";
import pathfinderPkg from "mineflayer-pathfinder";
import { BotManager, shortBlockName, normalizeBlockName } from "../bot/botManager.js";
import { ToolResult, ok, err } from "../result.js";
import {
  Coord,
  Frame,
  resolveCoord,
  resolveBox,
  yawToCardinal,
  boxVolume,
} from "../coords.js";
import { botRefFrom } from "../bot/botRef.js";

const { goals } = pathfinderPkg;

// ───────────────────────── PERC-1 get_position ───────────────────────────

export function getPosition(bm: BotManager): ToolResult {
  const bot = bm.require();
  const p = bot.entity.position;
  return ok("Position et orientation du bot.", {
    x: Math.floor(p.x),
    y: Math.floor(p.y),
    z: Math.floor(p.z),
    exact: { x: round2(p.x), y: round2(p.y), z: round2(p.z) },
    yaw: round2(bot.entity.yaw),
    pitch: round2(bot.entity.pitch),
    facing: yawToCardinal(bot.entity.yaw),
    gameMode: bm.detectGameMode(),
    dimension: bot.game?.dimension,
  });
}

// ───────────────────────── PERC-2 get_blocks_around ──────────────────────

export function getBlocksAround(
  bm: BotManager,
  center: Coord | undefined,
  radius: number,
  frame: Frame
): ToolResult {
  const bot = bm.require();
  const ref = botRefFrom(bot);
  const c = center ? resolveCoord(center, frame, ref) : {
    x: Math.floor(bot.entity.position.x),
    y: Math.floor(bot.entity.position.y),
    z: Math.floor(bot.entity.position.z),
  };
  const r = Math.max(0, Math.min(radius, 24));
  const blocks: { x: number; y: number; z: number; type: string }[] = [];
  for (let x = c.x - r; x <= c.x + r; x++)
    for (let y = c.y - r; y <= c.y + r; y++)
      for (let z = c.z - r; z <= c.z + r; z++) {
        const b = bot.blockAt(new Vec3(x, y, z));
        if (b && b.name !== "air") blocks.push({ x, y, z, type: b.name });
      }
  return ok(`${blocks.length} blocs ≠ air dans un rayon ${r} autour de (${c.x},${c.y},${c.z}).`, {
    center: c,
    radius: r,
    count: blocks.length,
    blocks,
  });
}

// ───────────────────────── PERC-3 get_block_at ───────────────────────────

export function getBlockAt(bm: BotManager, coord: Coord, frame: Frame): ToolResult {
  const bot = bm.require();
  const c = resolveCoord(coord, frame, botRefFrom(bot));
  const b = bot.blockAt(new Vec3(c.x, c.y, c.z));
  if (!b) {
    return err(
      `Bloc à (${c.x},${c.y},${c.z}) non chargé. Rapproche le bot (goto) ou utilise scan_region qui charge la zone.`,
      { pos: c }
    );
  }
  return ok(`Bloc à (${c.x},${c.y},${c.z}).`, {
    pos: c,
    type: b.name,
    displayName: b.displayName,
    properties: b.getProperties?.() ?? {},
    boundingBox: b.boundingBox,
  });
}

// ───────────────────────── PERC-4 scan_region (RLE) ──────────────────────

export interface RegionScan {
  min: Coord;
  max: Coord;
  dims: { x: number; y: number; z: number };
  /** Ordre d'itération : y (bas→haut), puis z, puis x. */
  order: "yzx";
  palette: string[];
  /** Run-length encoding : paires [indexPalette, longueur]. */
  rle: [number, number][];
}

export async function scanRegion(
  bm: BotManager,
  corner1: Coord,
  corner2: Coord,
  frame: Frame
): Promise<ToolResult<RegionScan>> {
  const bot = bm.require();
  const { min, max } = resolveBox(corner1, corner2, frame, botRefFrom(bot));
  const vol = boxVolume(min, max);
  if (vol > 500_000) {
    return err(
      `Zone trop grande à scanner (${vol} blocs). Limite ~500 000. Découpe la zone.`
    ) as ToolResult<RegionScan>;
  }
  await bm.ensureLoaded({ x: (min.x + max.x) >> 1, y: (min.y + max.y) >> 1, z: (min.z + max.z) >> 1 });

  const palette: string[] = [];
  const paletteIndex = new Map<string, number>();
  const idOf = (name: string): number => {
    let i = paletteIndex.get(name);
    if (i === undefined) {
      i = palette.length;
      palette.push(name);
      paletteIndex.set(name, i);
    }
    return i;
  };

  const rle: [number, number][] = [];
  let curId = -1;
  let curLen = 0;
  for (let y = min.y; y <= max.y; y++)
    for (let z = min.z; z <= max.z; z++)
      for (let x = min.x; x <= max.x; x++) {
        const b = bot.blockAt(new Vec3(x, y, z));
        const name = b ? b.name : "unknown";
        const id = idOf(name);
        if (id === curId) curLen++;
        else {
          if (curId >= 0) rle.push([curId, curLen]);
          curId = id;
          curLen = 1;
        }
      }
  if (curId >= 0) rle.push([curId, curLen]);

  return ok(`Zone scannée : ${vol} blocs, ${palette.length} types, ${rle.length} runs.`, {
    min,
    max,
    dims: { x: max.x - min.x + 1, y: max.y - min.y + 1, z: max.z - min.z + 1 },
    order: "yzx",
    palette,
    rle,
  });
}

// ───────────────────────── PERC-5 get_inventory ──────────────────────────

export function getInventory(bm: BotManager): ToolResult {
  const bot = bm.require();
  const items = bot.inventory.items().map((it) => ({
    name: it.name,
    displayName: it.displayName,
    count: it.count,
    slot: it.slot,
  }));
  const held = bot.heldItem ? { name: bot.heldItem.name, count: bot.heldItem.count } : null;
  return ok(`${items.length} piles d'items dans l'inventaire.`, { held, items });
}

// ───────────────────────── PERC-6 get_nearby_entities ────────────────────

export function getNearbyEntities(bm: BotManager, radius: number): ToolResult {
  const bot = bm.require();
  const r = Math.max(1, Math.min(radius, 64));
  const me = bot.entity.position;
  const list = Object.values(bot.entities)
    .filter((e) => e !== bot.entity && e.position && e.position.distanceTo(me) <= r)
    .map((e) => ({
      name: e.username ?? e.name ?? e.displayName ?? "?",
      type: e.type,
      kind: e.kind,
      pos: { x: Math.floor(e.position.x), y: Math.floor(e.position.y), z: Math.floor(e.position.z) },
      distance: round2(e.position.distanceTo(me)),
    }))
    .sort((a, b) => a.distance - b.distance);
  return ok(`${list.length} entités dans un rayon ${r}.`, { count: list.length, entities: list });
}

// ───────────────────────── PERC-7 find_blocks ────────────────────────────

export function findBlocks(
  bm: BotManager,
  type: string,
  radius: number,
  maxResults: number
): ToolResult {
  const bot = bm.require();
  const wanted = normalizeBlockName(type);
  const short = shortBlockName(wanted);
  const blockData = (bot.registry as any).blocksByName[short];
  if (!blockData) {
    return err(`Type de bloc inconnu : "${type}". Utilise un nom valide (ex. "stone", "oak_log").`);
  }
  const positions = bot.findBlocks({
    matching: blockData.id,
    maxDistance: Math.max(1, Math.min(radius, 128)),
    count: Math.max(1, Math.min(maxResults, 256)),
  });
  const coords = positions.map((p) => ({ x: p.x, y: p.y, z: p.z }));
  return ok(`${coords.length} bloc(s) "${short}" trouvé(s) dans un rayon ${radius}.`, {
    type: short,
    count: coords.length,
    positions: coords,
  });
}

// ───────────────────────── PERC-8 raycast ────────────────────────────────

export function raycast(bm: BotManager, maxDistance: number): ToolResult {
  const bot = bm.require();
  const d = Math.max(1, Math.min(maxDistance, 64));
  const block = bot.blockAtCursor(d);
  if (!block) {
    return ok(`Aucun bloc visé dans les ${d} blocs devant le regard.`, { hit: false });
  }
  return ok(`Bloc visé : ${block.name}.`, {
    hit: true,
    pos: { x: block.position.x, y: block.position.y, z: block.position.z },
    type: block.name,
    face: (block as any).face ?? null,
  });
}

// ───────────────────────── NAV-1..4 ──────────────────────────────────────

export async function goto(
  bm: BotManager,
  coord: Coord,
  frame: Frame,
  tolerance: number
): Promise<ToolResult> {
  const bot = bm.require();
  const c = resolveCoord(coord, frame, botRefFrom(bot));
  try {
    await bot.pathfinder.goto(new goals.GoalNear(c.x, c.y, c.z, Math.max(0, tolerance)));
    const p = bot.entity.position;
    return ok(`Arrivé près de (${c.x},${c.y},${c.z}).`, {
      target: c,
      position: { x: Math.floor(p.x), y: Math.floor(p.y), z: Math.floor(p.z) },
    });
  } catch (e) {
    return err(
      `Impossible d'atteindre (${c.x},${c.y},${c.z}) : ${(e as Error).message}. ` +
        `Obstacle ou chemin introuvable — essaie une cible plus proche ou dégage la zone.`
    );
  }
}

export async function lookAt(bm: BotManager, coord: Coord, frame: Frame): Promise<ToolResult> {
  const bot = bm.require();
  const c = resolveCoord(coord, frame, botRefFrom(bot));
  await bot.lookAt(new Vec3(c.x + 0.5, c.y + 0.5, c.z + 0.5), true);
  return ok(`Regard orienté vers (${c.x},${c.y},${c.z}).`, { target: c });
}

export async function followPlayer(
  bm: BotManager,
  name: string,
  distance: number
): Promise<ToolResult> {
  const bot = bm.require();
  const player = bot.players[name]?.entity;
  if (!player) return err(`Joueur "${name}" introuvable ou hors de vue.`);
  bot.pathfinder.setGoal(new goals.GoalFollow(player, Math.max(1, distance)), true);
  return ok(`Le bot suit "${name}" à ${distance} bloc(s). Utilise stop pour arrêter.`);
}

export function stop(bm: BotManager): ToolResult {
  const bot = bm.require();
  bot.pathfinder.setGoal(null);
  try { bot.clearControlStates(); } catch { /* ignore */ }
  return ok("Déplacement stoppé.");
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
