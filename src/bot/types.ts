import type { Coord } from "../coords.js";

/** Un bloc à poser : coordonnée absolue + identifiant de bloc Minecraft. */
export interface BlockPlacement {
  pos: Coord;
  /** Nom de bloc sans namespace (ex. "oak_planks") ou avec ("minecraft:oak_planks"). */
  type: string;
}

export interface PlacementProgress {
  done: number;
  total: number;
}

export type ProgressCallback = (p: PlacementProgress) => void;

export interface PlacementOutcome {
  requested: number;
  placed: number;
  /** Coordonnées non posées (hors volume, erreur, annulation). */
  failures: Coord[];
  cancelled: boolean;
}
