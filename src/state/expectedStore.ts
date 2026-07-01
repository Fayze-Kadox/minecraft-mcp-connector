import type { BlockPlacement } from "../bot/types.js";

/**
 * Mémorise le dernier état ATTENDU posé par une primitive/blueprint, pour que
 * verify_build / auto_repair puissent fonctionner sans ré-spécifier la cible.
 */
class ExpectedStore {
  private last: BlockPlacement[] = [];
  private label = "";

  set(label: string, placements: BlockPlacement[]): void {
    this.label = label;
    this.last = placements.slice();
  }

  get(): { label: string; placements: BlockPlacement[] } {
    return { label: this.label, placements: this.last };
  }

  has(): boolean {
    return this.last.length > 0;
  }
}

export const expectedStore = new ExpectedStore();
