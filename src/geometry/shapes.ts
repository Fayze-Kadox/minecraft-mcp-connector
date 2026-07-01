/**
 * Moteur géométrique — fonctions PURES.
 * Toutes prennent et renvoient des coordonnées ABSOLUES (entiers) déjà résolues.
 * Aucune dépendance au bot : 100 % testable hors ligne.
 */
import type { Coord } from "../coords.js";
import { coordKey } from "../coords.js";

export type FillMode = "solid" | "hollow" | "outline";
export type Axis = "x" | "y" | "z";

function uniq(coords: Coord[]): Coord[] {
  const seen = new Set<string>();
  const out: Coord[] = [];
  for (const c of coords) {
    const k = coordKey(c);
    if (!seen.has(k)) {
      seen.add(k);
      out.push(c);
    }
  }
  return out;
}

function minmax(a: Coord, b: Coord) {
  return {
    min: { x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), z: Math.min(a.z, b.z) },
    max: { x: Math.max(a.x, b.x), y: Math.max(a.y, b.y), z: Math.max(a.z, b.z) },
  };
}

// ───────────────────────── HIGH-1 fill_region ────────────────────────────

export function fillRegion(corner1: Coord, corner2: Coord, mode: FillMode): Coord[] {
  const { min, max } = minmax(corner1, corner2);
  const out: Coord[] = [];
  const onShell = (x: number, y: number, z: number) =>
    x === min.x || x === max.x ||
    y === min.y || y === max.y ||
    z === min.z || z === max.z;
  // « outline » = uniquement les 12 arêtes ; « hollow » = les 6 faces.
  const onEdge = (x: number, y: number, z: number) => {
    let onFace = 0;
    if (x === min.x || x === max.x) onFace++;
    if (y === min.y || y === max.y) onFace++;
    if (z === min.z || z === max.z) onFace++;
    return onFace >= 2;
  };
  for (let x = min.x; x <= max.x; x++)
    for (let y = min.y; y <= max.y; y++)
      for (let z = min.z; z <= max.z; z++) {
        if (mode === "solid") out.push({ x, y, z });
        else if (mode === "hollow" && onShell(x, y, z)) out.push({ x, y, z });
        else if (mode === "outline" && onEdge(x, y, z)) out.push({ x, y, z });
      }
  return out;
}

// ───────────────────────── HIGH-2 draw_line (3D Bresenham) ────────────────

export function drawLine(p1: Coord, p2: Coord): Coord[] {
  const out: Coord[] = [];
  let x = p1.x, y = p1.y, z = p1.z;
  const dx = Math.abs(p2.x - x), dy = Math.abs(p2.y - y), dz = Math.abs(p2.z - z);
  const sx = p2.x > x ? 1 : -1, sy = p2.y > y ? 1 : -1, sz = p2.z > z ? 1 : -1;
  const dm = Math.max(dx, dy, dz);
  let ex = dm / 2, ey = dm / 2, ez = dm / 2;
  for (let i = 0; i <= dm; i++) {
    out.push({ x, y, z });
    ex -= dx; if (ex < 0) { ex += dm; x += sx; }
    ey -= dy; if (ey < 0) { ey += dm; y += sy; }
    ez -= dz; if (ez < 0) { ez += dm; z += sz; }
  }
  return uniq(out);
}

// ───────────────────────── HIGH-3 build_wall ─────────────────────────────

export type Direction = "north" | "south" | "east" | "west" | "up" | "down";

const DIR_VEC: Record<Direction, Coord> = {
  north: { x: 0, y: 0, z: -1 },
  south: { x: 0, y: 0, z: 1 },
  east: { x: 1, y: 0, z: 0 },
  west: { x: -1, y: 0, z: 0 },
  up: { x: 0, y: 1, z: 0 },
  down: { x: 0, y: -1, z: 0 },
};

export function buildWall(
  origin: Coord,
  direction: Direction,
  length: number,
  height: number
): Coord[] {
  const d = DIR_VEC[direction];
  const out: Coord[] = [];
  for (let i = 0; i < length; i++)
    for (let h = 0; h < height; h++)
      out.push({ x: origin.x + d.x * i, y: origin.y + h, z: origin.z + d.z * i });
  return uniq(out);
}

// ───────────────────────── HIGH-4 build_floor_ceiling ────────────────────

export function buildSurface(corner1: Coord, corner2: Coord, y: number): Coord[] {
  const { min, max } = minmax({ ...corner1, y }, { ...corner2, y });
  const out: Coord[] = [];
  for (let x = min.x; x <= max.x; x++)
    for (let z = min.z; z <= max.z; z++) out.push({ x, y, z });
  return out;
}

// ───────────────────────── HIGH-5 build_box ──────────────────────────────

export interface Opening {
  /** Face où percer l'ouverture. */
  face: Direction;
  /** Décalage horizontal le long de la face (depuis le coin min). */
  offset: number;
  width: number;
  height: number;
  /** Hauteur de départ depuis le sol de la boîte (0 = sol). */
  sill?: number;
}

/**
 * Boîte/pièce : murs + sol + plafond, avec ouvertures (portes/fenêtres) percées.
 * Renvoie { blocks, openings } ; les coordonnées d'ouverture sont retirées des murs.
 */
export function buildBox(
  corner1: Coord,
  corner2: Coord,
  opts: { floor?: boolean; ceiling?: boolean; openings?: Opening[] } = {}
): { blocks: Coord[]; openingCells: Coord[] } {
  const { min, max } = minmax(corner1, corner2);
  const withFloor = opts.floor ?? true;
  const withCeiling = opts.ceiling ?? true;

  const shell = fillRegion(min, max, "hollow");
  // Retire sol/plafond si non désirés.
  let blocks = shell.filter((c) => {
    if (!withFloor && c.y === min.y) return false;
    if (!withCeiling && c.y === max.y) return false;
    return true;
  });

  const openingCells: Coord[] = [];
  for (const op of opts.openings ?? []) {
    openingCells.push(...computeOpeningCells(min, max, op));
  }
  const openSet = new Set(openingCells.map(coordKey));
  blocks = blocks.filter((c) => !openSet.has(coordKey(c)));
  return { blocks: uniq(blocks), openingCells: uniq(openingCells) };
}

function computeOpeningCells(min: Coord, max: Coord, op: Opening): Coord[] {
  const cells: Coord[] = [];
  const sill = op.sill ?? 0;
  const y0 = min.y + sill;
  const isWestEast = op.face === "east" || op.face === "west";
  // Mur concerné : plan x=const (est/ouest) ou z=const (nord/sud).
  for (let h = 0; h < op.height; h++) {
    for (let w = 0; w < op.width; w++) {
      const y = y0 + h;
      if (y < min.y || y > max.y) continue;
      if (op.face === "north") cells.push({ x: min.x + op.offset + w, y, z: min.z });
      else if (op.face === "south") cells.push({ x: min.x + op.offset + w, y, z: max.z });
      else if (op.face === "west") cells.push({ x: min.x, y, z: min.z + op.offset + w });
      else if (op.face === "east") cells.push({ x: max.x, y, z: min.z + op.offset + w });
    }
  }
  void isWestEast;
  return cells;
}

// ───────────────────────── HIGH-6 build_sphere ───────────────────────────

export function buildSphere(center: Coord, radius: number, hollow: boolean): Coord[] {
  const out: Coord[] = [];
  const r = radius;
  const r2 = (r + 0.5) * (r + 0.5);
  const inner2 = (r - 0.5) * (r - 0.5);
  for (let x = -r; x <= r; x++)
    for (let y = -r; y <= r; y++)
      for (let z = -r; z <= r; z++) {
        const d2 = x * x + y * y + z * z;
        if (d2 > r2) continue;
        if (hollow && d2 < inner2 - 0) {
          // ne garder que la coquille : un voisin doit être hors-sphère
          if (
            sq(x + 1, y, z) <= r2 && sq(x - 1, y, z) <= r2 &&
            sq(x, y + 1, z) <= r2 && sq(x, y - 1, z) <= r2 &&
            sq(x, y, z + 1) <= r2 && sq(x, y, z - 1) <= r2
          ) continue;
        }
        out.push({ x: center.x + x, y: center.y + y, z: center.z + z });
      }
  return out;
}

function sq(x: number, y: number, z: number) {
  return x * x + y * y + z * z;
}

// ───────────────────────── HIGH-7 build_cylinder ─────────────────────────

export function buildCylinder(
  baseCenter: Coord,
  radius: number,
  height: number,
  axis: Axis,
  hollow: boolean
): Coord[] {
  const out: Coord[] = [];
  const r2 = (radius + 0.5) * (radius + 0.5);
  const inner2 = (radius - 0.5) * (radius - 0.5);
  for (let a = -radius; a <= radius; a++)
    for (let b = -radius; b <= radius; b++) {
      const d2 = a * a + b * b;
      if (d2 > r2) continue;
      if (hollow && d2 < inner2) continue;
      for (let h = 0; h < height; h++) {
        if (axis === "y") out.push({ x: baseCenter.x + a, y: baseCenter.y + h, z: baseCenter.z + b });
        else if (axis === "x") out.push({ x: baseCenter.x + h, y: baseCenter.y + a, z: baseCenter.z + b });
        else out.push({ x: baseCenter.x + a, y: baseCenter.y + b, z: baseCenter.z + h });
      }
    }
  return uniq(out);
}

// ───────────────────────── HIGH-8 build_pyramid ──────────────────────────

/** Pyramide à base carrée centrée, rétrécissant d'un anneau par niveau. */
export function buildPyramid(
  baseCenter: Coord,
  baseHalfWidth: number,
  height: number,
  hollow: boolean
): Coord[] {
  const out: Coord[] = [];
  const levels = Math.min(height, baseHalfWidth + 1);
  for (let level = 0; level < levels; level++) {
    const half = baseHalfWidth - level;
    if (half < 0) break;
    const y = baseCenter.y + level;
    for (let x = -half; x <= half; x++)
      for (let z = -half; z <= half; z++) {
        const onRing = Math.abs(x) === half || Math.abs(z) === half;
        if (hollow && !onRing && level < levels - 1) continue;
        out.push({ x: baseCenter.x + x, y, z: baseCenter.z + z });
      }
  }
  return uniq(out);
}

// ───────────────────────── HIGH-9 build_stairs ───────────────────────────

/**
 * Escalier en blocs pleins : à chaque pas on avance d'1 et on monte d'1.
 * `width` = largeur latérale. `fillUnder` remplit la colonne sous chaque marche.
 */
export function buildStairs(
  origin: Coord,
  direction: Direction,
  length: number,
  width: number,
  fillUnder: boolean
): Coord[] {
  const d = DIR_VEC[direction];
  // vecteur latéral perpendiculaire horizontal
  const lat: Coord = d.z !== 0 ? { x: 1, y: 0, z: 0 } : { x: 0, y: 0, z: 1 };
  const out: Coord[] = [];
  for (let i = 0; i < length; i++) {
    const stepY = origin.y + i;
    for (let w = 0; w < width; w++) {
      const baseX = origin.x + d.x * i + lat.x * w;
      const baseZ = origin.z + d.z * i + lat.z * w;
      if (fillUnder) {
        for (let y = origin.y; y <= stepY; y++) out.push({ x: baseX, y, z: baseZ });
      } else {
        out.push({ x: baseX, y: stepY, z: baseZ });
      }
    }
  }
  return uniq(out);
}

export const _internal = { minmax, uniq };
