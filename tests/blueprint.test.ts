import { describe, it, expect } from "vitest";
import { compileBlueprint } from "../src/blueprint/compile.js";
import type { Blueprint } from "../src/blueprint/types.js";

const key = (c: { x: number; y: number; z: number }) => `${c.x},${c.y},${c.z}`;

describe("compileBlueprint — variante layers (BP-1)", () => {
  const house: Blueprint = {
    name: "petite_maison",
    origin: "relative",
    palette: { "#": "oak_planks", G: "glass", ".": "air", D: "oak_door" },
    layers: [
      { y: 0, rows: ["#####", "#...#", "#...#", "#...#", "#####"] },
      { y: 1, rows: ["##D##", "#...#", "G...G", "#...#", "#####"] },
    ],
  };

  it("ignore l'air et place les blocs de la palette", () => {
    const ps = compileBlueprint(house, { x: 0, y: 64, z: 0 });
    // couche 0 : périmètre 5x5 = 16 blocs ; intérieur = air (ignoré)
    const layer0 = ps.filter((p) => p.pos.y === 64);
    expect(layer0.length).toBe(16);
  });

  it("place la porte et les fenêtres au bon endroit en couche 1", () => {
    const ps = compileBlueprint(house, { x: 0, y: 64, z: 0 });
    const byKey = new Map(ps.map((p) => [key(p.pos), p.type]));
    expect(byKey.get("2,65,0")).toBe("oak_door"); // D au milieu de la 1re ligne
    expect(byKey.get("0,65,2")).toBe("glass"); // G à gauche
    expect(byKey.get("4,65,2")).toBe("glass"); // G à droite
  });

  it("origine décale toute la structure", () => {
    const a = compileBlueprint(house, { x: 0, y: 0, z: 0 });
    const b = compileBlueprint(house, { x: 100, y: 0, z: 50 });
    expect(b.length).toBe(a.length);
    const aKeys = new Set(a.map((p) => key(p.pos)));
    expect(aKeys.has("0,0,0")).toBe(true);
    const bKeys = new Set(b.map((p) => key(p.pos)));
    expect(bKeys.has("100,0,50")).toBe(true);
  });

  it("lève une erreur si un symbole manque dans la palette", () => {
    const bad: Blueprint = { name: "x", palette: { "#": "stone" }, layers: [{ y: 0, rows: ["#Z#"] }] };
    expect(() => compileBlueprint(bad, { x: 0, y: 0, z: 0 })).toThrow(/palette/);
  });
});

describe("compileBlueprint — variante primitives (BP-1)", () => {
  it("compose des primitives haut niveau sur une origine commune", () => {
    const bp: Blueprint = {
      name: "tour",
      primitives: [
        { op: "fill_region", args: { corner1: { x: 0, y: 0, z: 0 }, corner2: { x: 2, y: 0, z: 2 }, type: "stone", mode: "solid" } },
        { op: "build_cylinder", args: { baseCenter: { x: 1, y: 1, z: 1 }, radius: 1, height: 3, type: "cobblestone" } },
      ],
    };
    const ps = compileBlueprint(bp, { x: 10, y: 70, z: 10 });
    expect(ps.length).toBeGreaterThan(9);
    // le sol de pierre 3x3 doit être présent à y=70
    expect(ps.filter((p) => p.pos.y === 70).length).toBe(9);
  });
});
