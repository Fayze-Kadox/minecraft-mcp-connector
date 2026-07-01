import type { Frame } from "../coords.js";

/**
 * Format de BLUEPRINT (cf. spécification du format dans docs/blueprint-format.md).
 * Deux variantes possibles, exclusives :
 *   - "layers"     : grille par couches Y, avec palette symbole→bloc.
 *   - "primitives" : liste de primitives haut niveau composées sur une origine commune.
 */
export interface BlueprintLayer {
  /** Décalage Y de la couche (0 = base). */
  y: number;
  /** Lignes de symboles ; rows[0] = z minimal, chaque caractère = x croissant. */
  rows: string[];
}

export interface BlueprintPrimitive {
  /** Nom de primitive : fill_region | build_box | build_sphere | … */
  op: string;
  /** Arguments propres à la primitive (coordonnées RELATIVES à l'origine du blueprint). */
  args: Record<string, unknown>;
}

export interface Blueprint {
  name: string;
  /** Repère d'ancrage de l'origine ("absolute" | "relative" | "local"). */
  origin?: Frame;
  /** Palette symbole→type de bloc (variante layers). " " et "." = air par défaut. */
  palette?: Record<string, string>;
  layers?: BlueprintLayer[];
  primitives?: BlueprintPrimitive[];
  /** Métadonnées libres. */
  meta?: Record<string, unknown>;
}
