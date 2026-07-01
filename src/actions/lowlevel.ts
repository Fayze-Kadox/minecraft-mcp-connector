import { Vec3 } from "vec3";
import { BotManager } from "../bot/botManager.js";
import { ToolResult, ok, err } from "../result.js";
import { Coord, Frame, resolveCoord } from "../coords.js";
import { botRefFrom } from "../bot/botRef.js";
import type { Backend } from "../bot/botManager.js";

// ───────────────────────── LOW-1 place_block ─────────────────────────────

export async function placeBlock(
  bm: BotManager,
  coord: Coord,
  type: string,
  frame: Frame,
  backend: Backend
): Promise<ToolResult> {
  const c = resolveCoord(coord, frame, botRefFrom(bm.require()));
  const outcome = await bm.placeBlocks([{ pos: c, type }], { backend });
  if (outcome.placed === 1) return ok(`Bloc "${type}" posé à (${c.x},${c.y},${c.z}).`, { pos: c });
  return err(
    `Échec de la pose à (${c.x},${c.y},${c.z}). En survie, vérifie la portée et un appui adjacent ; ` +
      `sinon utilise le backend "command".`,
    { pos: c }
  );
}

// ───────────────────────── LOW-2 break_block ─────────────────────────────

export async function breakBlock(
  bm: BotManager,
  coord: Coord,
  frame: Frame,
  backend: Backend
): Promise<ToolResult> {
  const c = resolveCoord(coord, frame, botRefFrom(bm.require()));
  const outcome = await bm.breakBlocks([c], { backend });
  if (outcome.placed === 1) return ok(`Bloc cassé à (${c.x},${c.y},${c.z}).`, { pos: c });
  return err(`Échec du cassage à (${c.x},${c.y},${c.z}).`, { pos: c });
}

// ───────────────────────── LOW-3 use_item / interact ─────────────────────

export async function useItem(
  bm: BotManager,
  target: Coord | undefined,
  frame: Frame
): Promise<ToolResult> {
  const bot = bm.require();
  if (target) {
    const c = resolveCoord(target, frame, botRefFrom(bot));
    const blk = bot.blockAt(new Vec3(c.x, c.y, c.z));
    if (!blk) return err(`Aucun bloc à interagir à (${c.x},${c.y},${c.z}).`);
    await bot.lookAt(new Vec3(c.x + 0.5, c.y + 0.5, c.z + 0.5), true);
    try {
      await bot.activateBlock(blk);
      return ok(`Interaction avec ${blk.name} à (${c.x},${c.y},${c.z}).`);
    } catch (e) {
      return err(`Interaction impossible : ${(e as Error).message}.`);
    }
  }
  bot.activateItem();
  return ok("Item en main utilisé (clic droit).");
}
