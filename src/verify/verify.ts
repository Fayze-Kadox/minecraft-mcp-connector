import { Vec3 } from "vec3";
import { BotManager, shortBlockName } from "../bot/botManager.js";
import type { BlockPlacement } from "../bot/types.js";
import { ToolResult, ok, partial, err } from "../result.js";
import { Coord, Frame, resolveBox } from "../coords.js";
import { botRefFrom } from "../bot/botRef.js";
import { expectedStore } from "../state/expectedStore.js";

export interface Discrepancy {
  pos: Coord;
  expected: string;
  actual: string;
  kind: "missing" | "wrong_type";
}

export interface ConformanceReport {
  label: string;
  totalExpected: number;
  correct: number;
  conformancePct: number;
  discrepancies: number;
  sample: Discrepancy[];
}

/** Compare l'état attendu (placements) à l'état réel du monde. */
async function compare(
  bm: BotManager,
  label: string,
  expected: BlockPlacement[]
): Promise<ConformanceReport & { _all: Discrepancy[] }> {
  const bot = bm.require();
  if (expected.length) {
    const xs = expected.map((p) => p.pos.x);
    const ys = expected.map((p) => p.pos.y);
    const zs = expected.map((p) => p.pos.z);
    await bm.ensureLoaded({
      x: Math.round((Math.min(...xs) + Math.max(...xs)) / 2),
      y: Math.round((Math.min(...ys) + Math.max(...ys)) / 2),
      z: Math.round((Math.min(...zs) + Math.max(...zs)) / 2),
    });
  }

  const all: Discrepancy[] = [];
  let correct = 0;
  for (const p of expected) {
    const want = shortBlockName(p.type);
    const blk = bot.blockAt(new Vec3(p.pos.x, p.pos.y, p.pos.z));
    const actual = blk ? blk.name : "unknown";
    if (actual === want) {
      correct++;
    } else {
      all.push({
        pos: p.pos,
        expected: want,
        actual,
        kind: actual === "air" ? "missing" : "wrong_type",
      });
    }
  }
  const total = expected.length;
  const pct = total === 0 ? 100 : Math.round((correct / total) * 10000) / 100;
  return {
    label,
    totalExpected: total,
    correct,
    conformancePct: pct,
    discrepancies: all.length,
    sample: all.slice(0, 20),
    _all: all,
  };
}

// ───────────────────────── VERIF-1 verify_build ──────────────────────────

/**
 * Vérifie soit le dernier build mémorisé (expectedStore), soit un blueprint
 * fourni, soit une comparaison de zone. Renvoie un rapport de conformité.
 */
export async function verifyBuild(
  bm: BotManager,
  source: { kind: "last" } | { kind: "placements"; placements: BlockPlacement[]; label?: string }
): Promise<ToolResult<ConformanceReport>> {
  let expected: BlockPlacement[];
  let label: string;
  if (source.kind === "last") {
    const { label: l, placements } = expectedStore.get();
    if (!placements.length) {
      return err("Aucun build mémorisé à vérifier. Lance d'abord une primitive/blueprint, ou fournis des placements.") as ToolResult<ConformanceReport>;
    }
    expected = placements;
    label = l;
  } else {
    expected = source.placements;
    label = source.label ?? "custom";
  }

  const rep = await compare(bm, label, expected);
  const { _all, ...clean } = rep;
  void _all;
  bm.feedback(`🔍 Vérification ${label} : ${rep.conformancePct}% conforme (${rep.discrepancies} écart(s))`);
  const msg = `Conformité ${label} : ${rep.conformancePct}% (${rep.correct}/${rep.totalExpected}), ${rep.discrepancies} écart(s).`;
  return rep.discrepancies === 0 ? ok(msg, clean) : partial(msg + " auto_repair peut corriger.", clean);
}

// ───────────────────────── VERIF-2 auto_repair ───────────────────────────

export async function autoRepair(
  bm: BotManager,
  backend: any,
  shouldCancel?: () => boolean
): Promise<ToolResult> {
  const { label, placements } = expectedStore.get();
  if (!placements.length) return err("Rien à réparer : aucun build mémorisé.");

  const rep = await compare(bm, label, placements);
  if (rep._all.length === 0) return ok(`Aucun écart : ${label} déjà 100 % conforme.`);

  // Re-pose uniquement les blocs incorrects/manquants.
  const fixes: BlockPlacement[] = rep._all.map((d) => {
    const orig = placements.find((p) => p.pos.x === d.pos.x && p.pos.y === d.pos.y && p.pos.z === d.pos.z)!;
    return { pos: d.pos, type: orig.type };
  });
  const outcome = await bm.placeBlocks(fixes, { backend, shouldCancel });
  const after = await compare(bm, label, placements);
  const data = {
    repaired: outcome.placed,
    remaining: after.discrepancies,
    conformancePct: after.conformancePct,
  };
  if (after.discrepancies === 0) {
    bm.feedback(`🔧 Réparation ${label} : ${outcome.placed} bloc(s) corrigé(s) — 100% conforme`);
    return ok(`auto_repair : ${outcome.placed} bloc(s) corrigé(s) — ${label} 100 % conforme.`, data);
  }
  bm.feedback(`🔧 Réparation ${label} : ${outcome.placed} corrigé(s), ${after.discrepancies} restant(s) (${after.conformancePct}%)`);
  return partial(`auto_repair : ${outcome.placed} corrigé(s), ${after.discrepancies} écart(s) restant(s).`, data);
}

// ───────────────────────── Comparaison de zone (utilitaire) ───────────────

/** Compare deux zones identiques de dimensions (pour tests/diagnostic). */
export async function regionConformance(
  bm: BotManager,
  c1: Coord,
  c2: Coord,
  expectedType: string,
  frame: Frame
): Promise<ToolResult<ConformanceReport>> {
  const { min, max } = resolveBox(c1, c2, frame, botRefFrom(bm.require()));
  const placements: BlockPlacement[] = [];
  for (let x = min.x; x <= max.x; x++)
    for (let y = min.y; y <= max.y; y++)
      for (let z = min.z; z <= max.z; z++) placements.push({ pos: { x, y, z }, type: expectedType });
  return verifyBuild(bm, { kind: "placements", placements, label: `region:${expectedType}` });
}
