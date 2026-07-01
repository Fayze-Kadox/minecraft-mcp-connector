import { describe, it, expect } from "vitest";
import {
  fillRegion,
  drawLine,
  buildWall,
  buildSurface,
  buildBox,
  buildSphere,
  buildCylinder,
  buildPyramid,
  buildStairs,
} from "../src/geometry/shapes.js";
import { compressToFillRuns, dedupePlacements } from "../src/bot/blocks.js";
import { resolveCoord, yawToCardinal } from "../src/coords.js";
import { Vec3 } from "vec3";

const key = (c: { x: number; y: number; z: number }) => `${c.x},${c.y},${c.z}`;

describe("fill_region (HIGH-1)", () => {
  it("solid 10x10x10 = 1000 blocs uniques", () => {
    const cs = fillRegion({ x: 0, y: 0, z: 0 }, { x: 9, y: 9, z: 9 }, "solid");
    expect(cs.length).toBe(1000);
    expect(new Set(cs.map(key)).size).toBe(1000);
  });

  it("hollow 10x10x10 = coquille (1000 - 8x8x8 intérieur)", () => {
    const cs = fillRegion({ x: 0, y: 0, z: 0 }, { x: 9, y: 9, z: 9 }, "hollow");
    expect(cs.length).toBe(1000 - 8 * 8 * 8); // 488
  });

  it("outline = uniquement les 12 arêtes", () => {
    const cs = fillRegion({ x: 0, y: 0, z: 0 }, { x: 2, y: 2, z: 2 }, "outline");
    // cube 3x3x3 : arêtes = 8 coins + 12 milieux d'arête = 20
    expect(cs.length).toBe(20);
  });
});

describe("draw_line (HIGH-2)", () => {
  it("ligne diagonale est contiguë et inclut les extrémités", () => {
    const cs = drawLine({ x: 0, y: 0, z: 0 }, { x: 5, y: 5, z: 5 });
    expect(cs.length).toBe(6);
    expect(cs[0]).toEqual({ x: 0, y: 0, z: 0 });
    expect(cs[cs.length - 1]).toEqual({ x: 5, y: 5, z: 5 });
  });

  it("ligne droite sur un axe", () => {
    const cs = drawLine({ x: 0, y: 64, z: 0 }, { x: 10, y: 64, z: 0 });
    expect(cs.length).toBe(11);
  });
});

describe("build_wall (HIGH-3)", () => {
  it("mur 5 de long x 3 de haut = 15 blocs", () => {
    const cs = buildWall({ x: 0, y: 0, z: 0 }, "east", 5, 3);
    expect(cs.length).toBe(15);
    expect(cs.every((c) => c.x >= 0 && c.x <= 4 && c.y >= 0 && c.y <= 2)).toBe(true);
  });
});

describe("build_floor_ceiling (HIGH-4)", () => {
  it("surface plane à Y constant", () => {
    const cs = buildSurface({ x: 0, y: 0, z: 0 }, { x: 4, y: 99, z: 4 }, 10);
    expect(cs.length).toBe(25);
    expect(cs.every((c) => c.y === 10)).toBe(true);
  });
});

describe("build_box (HIGH-5)", () => {
  it("boîte creuse avec porte percée", () => {
    const { blocks, openingCells } = buildBox({ x: 0, y: 0, z: 0 }, { x: 4, y: 3, z: 4 }, {
      openings: [{ face: "north", offset: 2, width: 1, height: 2 }],
    });
    const shell = fillRegion({ x: 0, y: 0, z: 0 }, { x: 4, y: 3, z: 4 }, "hollow").length;
    expect(openingCells.length).toBe(2);
    expect(blocks.length).toBe(shell - 2);
    // la porte ne doit plus figurer dans les murs
    const set = new Set(blocks.map(key));
    for (const o of openingCells) expect(set.has(key(o))).toBe(false);
  });
});

describe("build_sphere (HIGH-6)", () => {
  it("sphère pleine r=8 : span ±8, symétrique, bornée par le cube", () => {
    const cs = buildSphere({ x: 0, y: 0, z: 0 }, 8, false);
    const xs = cs.map((c) => c.x);
    expect(Math.min(...xs)).toBe(-8);
    expect(Math.max(...xs)).toBe(8);
    // symétrie autour de l'origine
    expect(cs.filter((c) => c.x > 0).length).toBe(cs.filter((c) => c.x < 0).length);
    // plus volumineuse que la sphère mathématique mais bornée par le cube englobant
    expect(cs.length).toBeGreaterThan((4 / 3) * Math.PI * 8 ** 3);
    expect(cs.length).toBeLessThan(17 ** 3);
  });

  it("sphère creuse r=8 < sphère pleine", () => {
    const solid = buildSphere({ x: 0, y: 0, z: 0 }, 8, false).length;
    const hollow = buildSphere({ x: 0, y: 0, z: 0 }, 8, true).length;
    expect(hollow).toBeLessThan(solid);
    expect(hollow).toBeGreaterThan(0);
  });
});

describe("build_cylinder (HIGH-7)", () => {
  it("cylindre vertical : chaque couche identique", () => {
    const cs = buildCylinder({ x: 0, y: 0, z: 0 }, 4, 5, "y", false);
    const layer0 = cs.filter((c) => c.y === 0).length;
    const layer4 = cs.filter((c) => c.y === 4).length;
    expect(layer0).toBe(layer4);
    expect(cs.length).toBe(layer0 * 5);
  });
});

describe("build_pyramid (HIGH-8)", () => {
  it("rétrécit d'un anneau par niveau", () => {
    const cs = buildPyramid({ x: 0, y: 0, z: 0 }, 3, 4, false);
    const base = cs.filter((c) => c.y === 0).length; // 7x7 = 49
    const top = cs.filter((c) => c.y === 3).length; // 1x1 = 1
    expect(base).toBe(49);
    expect(top).toBe(1);
  });
});

describe("build_stairs (HIGH-9)", () => {
  it("monte d'1 et avance d'1 par marche", () => {
    const cs = buildStairs({ x: 0, y: 0, z: 0 }, "east", 5, 1, false);
    expect(cs.length).toBe(5);
    expect(cs.map((c) => c.y)).toEqual([0, 1, 2, 3, 4]);
    expect(cs.map((c) => c.x)).toEqual([0, 1, 2, 3, 4]);
  });
});

describe("compression /fill (perf NF 6.1)", () => {
  it("un mur plein se compresse en peu de runs /fill", () => {
    const cs = fillRegion({ x: 0, y: 0, z: 0 }, { x: 9, y: 0, z: 0 }, "solid");
    const runs = compressToFillRuns(cs.map((pos) => ({ pos, type: "stone" })));
    expect(runs.length).toBe(1);
    expect(runs[0].kind).toBe("fill");
  });

  it("dedupe garde le dernier type", () => {
    const out = dedupePlacements([
      { pos: { x: 0, y: 0, z: 0 }, type: "stone" },
      { pos: { x: 0, y: 0, z: 0 }, type: "glass" },
    ]);
    expect(out.length).toBe(1);
    expect(out[0].type).toBe("glass");
  });
});

describe("repères de coordonnées", () => {
  const ref = { position: new Vec3(100, 64, 200), yaw: 0 }; // yaw 0 = sud
  it("absolute = identité (arrondi)", () => {
    expect(resolveCoord({ x: 1.7, y: 2.2, z: 3.9 }, "absolute", ref)).toEqual({ x: 1, y: 2, z: 3 });
  });
  it("relative = décalage par rapport au bot", () => {
    expect(resolveCoord({ x: 1, y: 0, z: 2 }, "relative", ref)).toEqual({ x: 101, y: 64, z: 202 });
  });
  it("local : +Z avant pointe au sud quand yaw=0", () => {
    expect(yawToCardinal(0)).toBe("south");
    expect(resolveCoord({ x: 0, y: 0, z: 3 }, "local", ref)).toEqual({ x: 100, y: 64, z: 203 });
  });
});
