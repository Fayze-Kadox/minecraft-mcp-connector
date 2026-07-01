import type { Bot } from "mineflayer";
import { Vec3 } from "vec3";
import type { BotRef } from "../coords.js";

/** Construit le référentiel (position bloc + yaw) utilisé pour résoudre les repères. */
export function botRefFrom(bot: Bot): BotRef {
  const p = bot.entity.position;
  return {
    position: new Vec3(Math.floor(p.x), Math.floor(p.y), Math.floor(p.z)),
    yaw: bot.entity.yaw,
  };
}
