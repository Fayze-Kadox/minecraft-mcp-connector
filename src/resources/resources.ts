import prismarineItem from "prismarine-item";
import { BotManager, shortBlockName } from "../bot/botManager.js";
import { ToolResult, ok, err } from "../result.js";

// ───────────────────────── RES-2 set_creative_inventory ──────────────────

/** Donne des items au bot en créatif (remplit la hotbar). */
export async function setCreativeInventory(
  bm: BotManager,
  items: { type: string; count?: number }[]
): Promise<ToolResult> {
  const bot = bm.require();
  if (bm.detectGameMode() !== "creative") {
    return err("set_creative_inventory nécessite le mode créatif. Passe le bot/monde en créatif.");
  }
  const Item = (prismarineItem as any)(bot.version);
  const placed: string[] = [];
  const missing: string[] = [];
  let slot = 36; // début de la hotbar
  for (const it of items) {
    const name = shortBlockName(it.type);
    const data = (bot.registry as any).itemsByName[name];
    if (!data) { missing.push(it.type); continue; }
    try {
      await bot.creative.setInventorySlot(slot, new Item(data.id, Math.min(it.count ?? 64, 64)));
      placed.push(name);
      slot++;
      if (slot > 44) slot = 9; // déborde dans l'inventaire principal
    } catch {
      missing.push(it.type);
    }
  }
  if (missing.length) {
    return err(`Items inconnus/non placés : ${missing.join(", ")}. Items OK : ${placed.join(", ") || "(aucun)"}.`, { placed, missing });
  }
  return ok(`Inventaire créatif garni : ${placed.join(", ")}.`, { placed });
}

// ───────────────────────── RES-1 ensure_materials ────────────────────────

/**
 * Garantit que le bot a les blocs nécessaires (créatif). Calcule les types
 * manquants en main/inventaire et les ajoute.
 */
export async function ensureMaterials(
  bm: BotManager,
  types: string[]
): Promise<ToolResult> {
  const bot = bm.require();
  if (bm.detectGameMode() !== "creative") {
    return ok(
      "Mode survie : ensure_materials ne peut pas créer d'items. Utilise gather pour collecter, " +
        "ou passe en créatif.",
      { mode: "survival" }
    );
  }
  const have = new Set(bot.inventory.items().map((i) => i.name));
  const needed = [...new Set(types.map(shortBlockName))].filter((t) => !have.has(t));
  if (!needed.length) return ok("Tous les matériaux requis sont déjà disponibles.", { added: [] });
  const res = await setCreativeInventory(bm, needed.map((type) => ({ type, count: 64 })));
  return res.status === "success"
    ? ok(`Matériaux garantis : ${needed.join(", ")}.`, { added: needed })
    : res;
}

// ───────────────────────── RES-3 gather (survie, optionnel) ───────────────

export async function gather(
  bm: BotManager,
  type: string,
  amount: number
): Promise<ToolResult> {
  const bot = bm.require();
  const short = shortBlockName(type);
  const data = (bot.registry as any).blocksByName[short];
  if (!data) return err(`Bloc inconnu : "${type}".`);

  let collected = 0;
  const max = Math.max(1, Math.min(amount, 64));
  for (let i = 0; i < max; i++) {
    const found = bot.findBlock({ matching: data.id, maxDistance: 32 });
    if (!found) break;
    try {
      const pf: any = await import("mineflayer-pathfinder");
      const goals = pf.goals ?? pf.default?.goals;
      await bot.pathfinder.goto(new goals.GoalNear(found.position.x, found.position.y, found.position.z, 2));
      await bot.dig(found);
      collected++;
    } catch {
      break;
    }
  }
  return collected >= max
    ? ok(`Collecté ${collected}× ${short}.`, { collected })
    : ok(`Collecté ${collected}/${max} ${short} (plus aucun à proximité ou inatteignable).`, { collected });
}
