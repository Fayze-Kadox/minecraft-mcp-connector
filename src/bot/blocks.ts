import type { Coord } from "../coords.js";
import { coordKey } from "../coords.js";
import type { BlockPlacement } from "./types.js";

/** Normalise un nom de bloc vers la forme "minecraft:xxx". */
export function normalizeBlockName(name: string): string {
  const n = name.trim().toLowerCase();
  return n.includes(":") ? n : `minecraft:${n}`;
}

/** Nom de bloc sans namespace (pour comparaison avec block.name de Mineflayer). */
export function shortBlockName(name: string): string {
  return name.includes(":") ? name.split(":")[1] : name;
}

export type FillRun =
  | { kind: "fill"; min: Coord; max: Coord; type: string; count: number }
  | { kind: "set"; pos: Coord; type: string; count: number };

/**
 * Compresse une liste de poses en segments /fill alignés sur X (runs contigus de
 * même type), le reste en /setblock. Réduit massivement le nombre de commandes
 * pour les murs/sols/volumes pleins tout en restant correct pour les formes.
 * Fonction PURE — testable hors ligne.
 */
export function compressToFillRuns(placements: BlockPlacement[]): FillRun[] {
  const byLine = new Map<string, { x: number; type: string }[]>();
  for (const p of placements) {
    const lineKey = `${p.pos.y}|${p.pos.z}`;
    if (!byLine.has(lineKey)) byLine.set(lineKey, []);
    byLine.get(lineKey)!.push({ x: p.pos.x, type: normalizeBlockName(p.type) });
  }

  const runs: FillRun[] = [];
  for (const [lineKey, cells] of byLine) {
    const [yStr, zStr] = lineKey.split("|");
    const y = Number(yStr);
    const z = Number(zStr);
    cells.sort((a, b) => a.x - b.x);

    let i = 0;
    while (i < cells.length) {
      let j = i;
      while (
        j + 1 < cells.length &&
        cells[j + 1].x === cells[j].x + 1 &&
        cells[j + 1].type === cells[i].type
      ) {
        j++;
      }
      const len = j - i + 1;
      if (len >= 3) {
        runs.push({
          kind: "fill",
          min: { x: cells[i].x, y, z },
          max: { x: cells[j].x, y, z },
          type: cells[i].type,
          count: len,
        });
      } else {
        for (let k = i; k <= j; k++) {
          runs.push({ kind: "set", pos: { x: cells[k].x, y, z }, type: cells[k].type, count: 1 });
        }
      }
      i = j + 1;
    }
  }
  return runs;
}

/** Déduplique une liste de poses (dernière l'emporte) en gardant l'ordre stable. */
export function dedupePlacements(placements: BlockPlacement[]): BlockPlacement[] {
  const map = new Map<string, BlockPlacement>();
  for (const p of placements) map.set(coordKey(p.pos), p);
  return [...map.values()];
}
