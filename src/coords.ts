import type { Vec3 } from "vec3";

/**
 * CONVENTION DE COORDONNEES (exigence transverse HIGH du cahier des charges)
 * Toutes les primitives acceptent un champ optionnel `frame` :
 *   - "absolute" (defaut) : x,y,z sont les coordonnees monde Minecraft.
 *   - "relative"          : x,y,z sont relatifs a la position du bot (sans rotation).
 *   - "local"             : x,y,z sont relatifs a la position ET a l'orientation
 *                            du bot. +Z avant, +X droite, +Y haut (rotations cardinales).
 */
export type Frame = "absolute" | "relative" | "local";

export interface Coord {
  x: number;
  y: number;
  z: number;
}

export interface BotRef {
  /** Position du bloc sous le bot (entiers). */
  position: Vec3;
  /** Yaw du bot en radians (convention Mineflayer). */
  yaw: number;
}

export type Cardinal = "north" | "east" | "south" | "west";

/** Convertit un yaw Mineflayer en direction cardinale (vers ou le bot regarde). */
export function yawToCardinal(yaw: number): Cardinal {
  const deg = ((yaw * 180) / Math.PI + 360) % 360;
  if (deg >= 45 && deg < 135) return "west";
  if (deg >= 135 && deg < 225) return "north";
  if (deg >= 225 && deg < 315) return "east";
  return "south";
}

function forwardVector(card: Cardinal): Coord {
  switch (card) {
    case "south": return { x: 0, y: 0, z: 1 };
    case "north": return { x: 0, y: 0, z: -1 };
    case "east": return { x: 1, y: 0, z: 0 };
    case "west": return { x: -1, y: 0, z: 0 };
  }
}

function rightVector(card: Cardinal): Coord {
  switch (card) {
    case "south": return { x: -1, y: 0, z: 0 };
    case "north": return { x: 1, y: 0, z: 0 };
    case "east": return { x: 0, y: 0, z: 1 };
    case "west": return { x: 0, y: 0, z: -1 };
  }
}

/** Resout une coordonnee exprimee dans un repere vers le repere ABSOLU monde. */
export function resolveCoord(c: Coord, frame: Frame, bot: BotRef): Coord {
  if (frame === "absolute") {
    return { x: Math.floor(c.x), y: Math.floor(c.y), z: Math.floor(c.z) };
  }

  const base = {
    x: Math.floor(bot.position.x),
    y: Math.floor(bot.position.y),
    z: Math.floor(bot.position.z),
  };

  if (frame === "relative") {
    return { x: base.x + Math.round(c.x), y: base.y + Math.round(c.y), z: base.z + Math.round(c.z) };
  }

  const card = yawToCardinal(bot.yaw);
  const fwd = forwardVector(card);
  const right = rightVector(card);
  return {
    x: base.x + Math.round(c.z) * fwd.x + Math.round(c.x) * right.x,
    y: base.y + Math.round(c.y),
    z: base.z + Math.round(c.z) * fwd.z + Math.round(c.x) * right.z,
  };
}

/** Normalise deux coins en (min, max) inclusifs, en repere absolu. */
export function resolveBox(
  corner1: Coord,
  corner2: Coord,
  frame: Frame,
  bot: BotRef
): { min: Coord; max: Coord } {
  const a = resolveCoord(corner1, frame, bot);
  const b = resolveCoord(corner2, frame, bot);
  return {
    min: { x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), z: Math.min(a.z, b.z) },
    max: { x: Math.max(a.x, b.x), y: Math.max(a.y, b.y), z: Math.max(a.z, b.z) },
  };
}

export function boxVolume(min: Coord, max: Coord): number {
  return (max.x - min.x + 1) * (max.y - min.y + 1) * (max.z - min.z + 1);
}

export function coordKey(c: Coord): string {
  return `${c.x},${c.y},${c.z}`;
}
