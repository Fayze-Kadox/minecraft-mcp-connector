import { ToolError } from "../result.js";
import type { Coord } from "../coords.js";
import { coordKey } from "../coords.js";
import type { BlockPlacement } from "../bot/types.js";
import * as shapes from "../geometry/shapes.js";
import type { Blueprint } from "./types.js";

/**
 * Compilation de blueprint — fonctions PURES (aucune dépendance au bot).
 * Séparées de blueprint.ts pour rester testables sans charger Mineflayer.
 */

const AIR_SYMBOLS = new Set([" ", ".", "_", "-"]);

/** Compile un blueprint en liste de poses ABSOLUES depuis une origine absolue. */
export function compileBlueprint(bp: Blueprint, origin: Coord): BlockPlacement[] {
  const map = new Map<string, BlockPlacement>();
  const put = (pos: Coord, type: string) => {
    if (!type || type === "air") return;
    map.set(coordKey(pos), { pos, type });
  };

  if (bp.layers?.length) {
    const palette = bp.palette ?? {};
    for (const layer of bp.layers) {
      for (let zi = 0; zi < layer.rows.length; zi++) {
        const row = layer.rows[zi];
        for (let xi = 0; xi < row.length; xi++) {
          const sym = row[xi];
          if (AIR_SYMBOLS.has(sym)) continue;
          const type = palette[sym];
          if (!type) throw new ToolError(`Symbole "${sym}" absent de la palette du blueprint "${bp.name}".`);
          put({ x: origin.x + xi, y: origin.y + layer.y, z: origin.z + zi }, type);
        }
      }
    }
  }

  if (bp.primitives?.length) {
    for (const prim of bp.primitives) {
      for (const { pos, type } of compilePrimitive(prim, origin)) put(pos, type);
    }
  }

  if (!bp.layers?.length && !bp.primitives?.length) {
    throw new ToolError(`Blueprint "${bp.name}" vide : fournis "layers" ou "primitives".`);
  }
  return [...map.values()];
}

function rel(origin: Coord, a: any): Coord {
  return { x: origin.x + Number(a?.x ?? 0), y: origin.y + Number(a?.y ?? 0), z: origin.z + Number(a?.z ?? 0) };
}

function compilePrimitive(prim: { op: string; args: any }, origin: Coord): BlockPlacement[] {
  const a = prim.args ?? {};
  const type = String(a.type ?? a.block ?? "stone");
  const toPlace = (coords: Coord[]) => coords.map((pos) => ({ pos, type }));
  switch (prim.op) {
    case "fill_region":
      return toPlace(shapes.fillRegion(rel(origin, a.corner1 ?? a.c1), rel(origin, a.corner2 ?? a.c2), (a.mode ?? "solid")));
    case "draw_line":
      return toPlace(shapes.drawLine(rel(origin, a.p1), rel(origin, a.p2)));
    case "build_wall":
      return toPlace(shapes.buildWall(rel(origin, a.origin ?? a), a.direction, Number(a.length), Number(a.height)));
    case "build_surface":
    case "build_floor_ceiling": {
      const c1 = rel(origin, a.corner1 ?? a.c1);
      const c2 = rel(origin, a.corner2 ?? a.c2);
      return toPlace(shapes.buildSurface(c1, c2, c1.y));
    }
    case "build_box": {
      const { blocks } = shapes.buildBox(rel(origin, a.corner1 ?? a.c1), rel(origin, a.corner2 ?? a.c2), {
        floor: a.floor, ceiling: a.ceiling, openings: a.openings,
      });
      return toPlace(blocks);
    }
    case "build_sphere":
      return toPlace(shapes.buildSphere(rel(origin, a.center), Number(a.radius), Boolean(a.hollow)));
    case "build_cylinder":
      return toPlace(shapes.buildCylinder(rel(origin, a.baseCenter ?? a.center), Number(a.radius), Number(a.height), (a.axis ?? "y"), Boolean(a.hollow)));
    case "build_pyramid":
      return toPlace(shapes.buildPyramid(rel(origin, a.baseCenter ?? a.center), Number(a.baseHalfWidth ?? a.half), Number(a.height), Boolean(a.hollow)));
    case "build_stairs":
      return toPlace(shapes.buildStairs(rel(origin, a.origin ?? a), a.direction, Number(a.length), Number(a.width ?? 1), Boolean(a.fillUnder)));
    default:
      throw new ToolError(`Primitive de blueprint inconnue : "${prim.op}".`);
  }
}

/** Tri de pose : du bas (y croissant) vers le haut pour ne pas se bloquer. */
export function sortBottomUp(p: BlockPlacement[]): BlockPlacement[] {
  return p.slice().sort((a, b) => a.pos.y - b.pos.y || a.pos.z - b.pos.z || a.pos.x - b.pos.x);
}
