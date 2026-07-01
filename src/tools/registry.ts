import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { AppConfig } from "../config.js";
import { BotManager } from "../bot/botManager.js";
import { ToolResult, ok, err } from "../result.js";
import { ToolError } from "../result.js";

import * as perc from "../perception/perception.js";
import * as low from "../actions/lowlevel.js";
import * as prim from "../geometry/primitives.js";
import * as bp from "../blueprint/blueprint.js";
import * as res from "../resources/resources.js";
import * as verify from "../verify/verify.js";
import * as safe from "../safety/checkpoint.js";

// ───────────────────────── Schémas partagés ──────────────────────────────

const Coord = z.object({ x: z.number(), y: z.number(), z: z.number() });
const frameField = z
  .enum(["absolute", "relative", "local"])
  .default("absolute")
  .describe("Repère des coordonnées : absolute (monde), relative (au bot), local (au bot+orientation).");
const typeField = z.string().describe("Nom de bloc Minecraft, ex. 'oak_planks' ou 'minecraft:stone'.");
const directionField = z.enum(["north", "south", "east", "west", "up", "down"]);

type Handler = (args: any) => Promise<ToolResult> | ToolResult;

export interface RegistryDeps {
  bm: BotManager;
  cfg: AppConfig;
  /** Jeton d'annulation global (positionné par un futur outil "stop_build"). */
  cancelToken: { cancelled: boolean };
}

export function registerAllTools(server: McpServer, deps: RegistryDeps): void {
  const { bm, cfg, cancelToken } = deps;
  const disabled = new Set(cfg.disabledTools);

  // Le backend par défaut vient de la config (--backend / MC_BACKEND / config.json).
  const backendField = z
    .enum(["command", "interact"])
    .default(cfg.bot.defaultBackend)
    .describe("Backend de pose : command (/setblock & /fill, créatif+cheats, recommandé) ou interact (pose physique, survie).");

  const exec: prim.ExecOptions = {
    shouldCancel: () => cancelToken.cancelled,
  };

  /**
   * Enregistre un outil sauf s'il est désactivé ; sérialise le ToolResult.
   * `needsBot` (défaut true) : connexion PARESSEUSE avant l'exécution — le bot
   * ne se connecte qu'ici, à la première action Minecraft. En cas d'échec de
   * connexion, on renvoie une erreur propre (pas de spam, pas de boucle).
   */
  function tool(
    name: string,
    description: string,
    shape: z.ZodRawShape,
    handler: Handler,
    needsBot = true
  ) {
    if (disabled.has(name)) return;
    server.registerTool(
      name,
      { description, inputSchema: shape },
      async (args: any) => {
        let result: ToolResult;
        try {
          if (needsBot) await bm.ensureConnected();
          result = await handler(args);
        } catch (e) {
          const msg = e instanceof ToolError ? e.message : `Erreur interne: ${(e as Error).message}`;
          result = err(msg);
        }
        return {
          content: [{ type: "text" as const, text: JSON.stringify(result) }],
          isError: result.status === "error",
        };
      }
    );
  }

  const withCancel = (backend?: "command" | "interact"): prim.ExecOptions => ({
    ...exec,
    backend,
  });

  // ─────────────── Connexion / état ───────────────
  tool("connect", "Connecte le bot au serveur Minecraft (LAN/local). Optionnel : les autres outils se connectent automatiquement à la demande.", {}, async () => {
    await bm.ensureConnected();
    return perc.getPosition(bm);
  }, false);
  tool("disconnect", "Déconnecte proprement le bot du serveur (stoppe aussi la reconnexion auto).", {}, async () => {
    await bm.disconnect();
    return { status: "success", message: "Bot déconnecté." } as ToolResult;
  }, false);
  tool("get_status", "État de connexion + position/mode de jeu du bot (ne déclenche pas de connexion).", {}, () =>
    bm.isConnected() ? perc.getPosition(bm) : ok("Bot non connecté. Une action Minecraft déclenchera la connexion, ou utilise connect.", { connected: false })
  , false);

  // ─────────────── 5.1 Perception ───────────────
  tool("get_position", "PERC-1 — Position et orientation actuelles du bot (x,y,z,yaw,pitch,direction).", {}, () => perc.getPosition(bm));

  tool("get_blocks_around", "PERC-2 — Scanne les blocs ≠ air dans un rayon autour d'un centre (défaut: le bot).", {
    center: Coord.optional(),
    radius: z.number().int().min(0).max(24).default(4),
    frame: frameField,
  }, (a) => perc.getBlocksAround(bm, a.center, a.radius, a.frame));

  tool("get_block_at", "PERC-3 — Type et propriétés du bloc à des coordonnées précises.", {
    pos: Coord, frame: frameField,
  }, (a) => perc.getBlockAt(bm, a.pos, a.frame));

  tool("scan_region", "PERC-4 — Scan complet d'une boîte, encodé en RLE (compact) pour comparaison/blueprint.", {
    corner1: Coord, corner2: Coord, frame: frameField,
  }, (a) => perc.scanRegion(bm, a.corner1, a.corner2, a.frame));

  tool("get_inventory", "PERC-5 — Contenu de l'inventaire du bot (items + quantités).", {}, () => perc.getInventory(bm));

  tool("get_nearby_entities", "PERC-6 — Joueurs/mobs proches (nom, type, position, distance).", {
    radius: z.number().int().min(1).max(64).default(16),
  }, (a) => perc.getNearbyEntities(bm, a.radius));

  tool("find_blocks", "PERC-7 — Localise les blocs d'un type donné dans un rayon.", {
    type: typeField, radius: z.number().int().min(1).max(128).default(32),
    maxResults: z.number().int().min(1).max(256).default(32),
  }, (a) => perc.findBlocks(bm, a.type, a.radius, a.maxResults));

  tool("raycast", "PERC-8 — Bloc visé par le regard du bot (coord + face).", {
    maxDistance: z.number().int().min(1).max(64).default(5),
  }, (a) => perc.raycast(bm, a.maxDistance));

  // ─────────────── 5.2 Navigation ───────────────
  tool("goto", "NAV-1 — Se rend à des coordonnées via pathfinding.", {
    pos: Coord, tolerance: z.number().int().min(0).max(8).default(1), frame: frameField,
  }, (a) => perc.goto(bm, a.pos, a.frame, a.tolerance));

  tool("look_at", "NAV-2 — Oriente le regard vers un point.", {
    pos: Coord, frame: frameField,
  }, (a) => perc.lookAt(bm, a.pos, a.frame));

  tool("follow_player", "NAV-3 — Suit un joueur à une distance donnée (stop pour arrêter).", {
    name: z.string(), distance: z.number().int().min(1).max(16).default(3),
  }, (a) => perc.followPlayer(bm, a.name, a.distance));

  tool("stop", "NAV-4 — Stoppe tout déplacement en cours.", {}, () => perc.stop(bm));

  // ─────────────── 5.3 Actions bas niveau ───────────────
  tool("place_block", "LOW-1 — Pose UN bloc. Pour plusieurs blocs, préfère les primitives haut niveau (fill_region, build_wall…).", {
    pos: Coord, type: typeField, frame: frameField, backend: backendField,
  }, (a) => low.placeBlock(bm, a.pos, a.type, a.frame, a.backend));

  tool("break_block", "LOW-2 — Casse le bloc à une position.", {
    pos: Coord, frame: frameField, backend: backendField,
  }, (a) => low.breakBlock(bm, a.pos, a.frame, a.backend));

  tool("use_item", "LOW-3 — Utilise l'item en main / interagit avec un bloc (porte, levier…).", {
    target: Coord.optional(), frame: frameField,
  }, (a) => low.useItem(bm, a.target, a.frame));

  // ─────────────── 5.4 Primitives haut niveau ───────────────
  tool("fill_region", "HIGH-1 — Remplit une boîte (solid/hollow/outline) en UN appel. Préfère ceci à des place_block en boucle.", {
    corner1: Coord, corner2: Coord, type: typeField,
    mode: z.enum(["solid", "hollow", "outline"]).default("solid"),
    frame: frameField, backend: backendField,
  }, (a) => prim.fillRegion(bm, a.corner1, a.corner2, a.type, a.mode, a.frame, withCancel(a.backend)));

  tool("draw_line", "HIGH-2 — Ligne droite de blocs entre deux points (Bresenham 3D).", {
    p1: Coord, p2: Coord, type: typeField, frame: frameField, backend: backendField,
  }, (a) => prim.drawLine(bm, a.p1, a.p2, a.type, a.frame, withCancel(a.backend)));

  tool("build_wall", "HIGH-3 — Mur vertical depuis une origine, dans une direction.", {
    origin: Coord, direction: directionField, length: z.number().int().min(1),
    height: z.number().int().min(1), type: typeField, frame: frameField, backend: backendField,
  }, (a) => prim.buildWall(bm, a.origin, a.direction, a.length, a.height, a.type, a.frame, withCancel(a.backend)));

  tool("build_floor_ceiling", "HIGH-4 — Surface horizontale plane entre deux coins (au Y du premier coin).", {
    corner1: Coord, corner2: Coord, type: typeField, frame: frameField, backend: backendField,
  }, (a) => prim.buildSurface(bm, a.corner1, a.corner2, a.type, a.frame, withCancel(a.backend)));

  tool("build_box", "HIGH-5 — Boîte/pièce creuse (murs + sol + plafond) avec ouvertures optionnelles (portes/fenêtres).", {
    corner1: Coord, corner2: Coord, type: typeField,
    floor: z.boolean().default(true), ceiling: z.boolean().default(true),
    openings: z.array(z.object({
      face: directionField, offset: z.number().int(), width: z.number().int().min(1),
      height: z.number().int().min(1), sill: z.number().int().optional(),
    })).optional(),
    doorBlock: z.string().optional().describe("Bloc à poser dans la 1re ouverture au niveau du sol (ex. oak_door)."),
    frame: frameField, backend: backendField,
  }, (a) => prim.buildBox(bm, a.corner1, a.corner2, a.type, a.frame,
    { floor: a.floor, ceiling: a.ceiling, openings: a.openings, doorBlock: a.doorBlock }, withCancel(a.backend)));

  tool("build_sphere", "HIGH-6 — Sphère pleine ou creuse.", {
    center: Coord, radius: z.number().int().min(1).max(64), type: typeField,
    hollow: z.boolean().default(false), frame: frameField, backend: backendField,
  }, (a) => prim.buildSphere(bm, a.center, a.radius, a.type, a.hollow, a.frame, withCancel(a.backend)));

  tool("build_cylinder", "HIGH-7 — Cylindre selon un axe (x/y/z), plein ou creux.", {
    baseCenter: Coord, radius: z.number().int().min(1).max(64), height: z.number().int().min(1),
    axis: z.enum(["x", "y", "z"]).default("y"), type: typeField,
    hollow: z.boolean().default(false), frame: frameField, backend: backendField,
  }, (a) => prim.buildCylinder(bm, a.baseCenter, a.radius, a.height, a.axis, a.type, a.hollow, a.frame, withCancel(a.backend)));

  tool("build_pyramid", "HIGH-8 — Pyramide / toit pyramidal à base carrée.", {
    baseCenter: Coord, baseHalfWidth: z.number().int().min(1).max(64), height: z.number().int().min(1),
    type: typeField, hollow: z.boolean().default(false), frame: frameField, backend: backendField,
  }, (a) => prim.buildPyramid(bm, a.baseCenter, a.baseHalfWidth, a.height, a.type, a.hollow, a.frame, withCancel(a.backend)));

  tool("build_stairs", "HIGH-9 — Escalier en blocs pleins (monte d'1, avance d'1 par marche).", {
    origin: Coord, direction: directionField, length: z.number().int().min(1),
    width: z.number().int().min(1).default(1), fillUnder: z.boolean().default(true),
    type: typeField, frame: frameField, backend: backendField,
  }, (a) => prim.buildStairs(bm, a.origin, a.direction, a.length, a.width, a.fillUnder, a.type, a.frame, withCancel(a.backend)));

  tool("clear_region", "HIGH-10 — Vide une zone (remplit d'air).", {
    corner1: Coord, corner2: Coord, frame: frameField, backend: backendField,
  }, (a) => prim.clearRegion(bm, a.corner1, a.corner2, a.frame, withCancel(a.backend)));

  tool("replace_blocks", "HIGH-11 — Remplace un type de bloc par un autre dans une zone.", {
    corner1: Coord, corner2: Coord, oldType: typeField, newType: typeField,
    frame: frameField, backend: backendField,
  }, (a) => prim.replaceBlocks(bm, a.corner1, a.corner2, a.oldType, a.newType, a.frame, withCancel(a.backend)));

  // ─────────────── 5.5 Blueprints ───────────────
  const blueprintSchema = z.object({
    name: z.string(),
    origin: z.enum(["absolute", "relative", "local"]).optional(),
    palette: z.record(z.string()).optional(),
    layers: z.array(z.object({ y: z.number().int(), rows: z.array(z.string()) })).optional(),
    primitives: z.array(z.object({ op: z.string(), args: z.record(z.any()) })).optional(),
    meta: z.record(z.any()).optional(),
  });

  tool("build_blueprint", "BP-1 — Construit une structure complète décrite par un blueprint (couches+palette ou primitives composées). Pose du bas vers le haut, en un seul appel.", {
    blueprint: blueprintSchema, origin: Coord, frame: frameField, backend: backendField,
  }, (a) => bp.buildBlueprint(bm, a.blueprint, a.origin, a.frame, withCancel(a.backend)));

  tool("save_blueprint", "BP-2 — Sauvegarde un blueprint nommé sur disque (réutilisation).", {
    blueprint: blueprintSchema,
  }, (a) => bp.saveBlueprint(cfg.blueprintsDir, a.blueprint), false);

  tool("load_blueprint", "BP-2 — Charge un blueprint nommé depuis le disque.", {
    name: z.string(),
  }, (a) => bp.loadBlueprint(cfg.blueprintsDir, a.name), false);

  tool("list_blueprints", "BP-2 — Liste les blueprints sauvegardés.", {}, () => bp.listBlueprints(cfg.blueprintsDir), false);

  tool("capture_blueprint", "BP-3 — Scanne une zone existante et en produit un blueprint (copier/coller de structure).", {
    name: z.string(), corner1: Coord, corner2: Coord,
    includeAir: z.boolean().default(false), frame: frameField,
  }, (a) => bp.captureBlueprint(bm, a.name, a.corner1, a.corner2, a.frame, a.includeAir));

  // ─────────────── 5.6 Ressources ───────────────
  tool("ensure_materials", "RES-1 — (Créatif) garantit que le bot dispose des blocs nécessaires avant un build.", {
    types: z.array(typeField),
  }, (a) => res.ensureMaterials(bm, a.types));

  tool("set_creative_inventory", "RES-2 — (Créatif) garnit l'inventaire du bot avec les items demandés.", {
    items: z.array(z.object({ type: typeField, count: z.number().int().min(1).max(64).optional() })),
  }, (a) => res.setCreativeInventory(bm, a.items));

  tool("gather", "RES-3 — (Survie) va miner/collecter un type de bloc en quantité.", {
    type: typeField, amount: z.number().int().min(1).max(64).default(8),
  }, (a) => res.gather(bm, a.type, a.amount));

  // ─────────────── 5.7 Vérification / auto-correction ───────────────
  tool("verify_build", "VERIF-1 — Compare le dernier build (ou des placements fournis) au monde réel ; renvoie un rapport de conformité (% + écarts).", {
    placements: z.array(z.object({ pos: Coord, type: typeField })).optional()
      .describe("Optionnel : état attendu explicite. Sinon, vérifie le dernier build mémorisé."),
    label: z.string().optional(),
  }, (a) => a.placements
    ? verify.verifyBuild(bm, { kind: "placements", placements: a.placements, label: a.label })
    : verify.verifyBuild(bm, { kind: "last" }));

  tool("auto_repair", "VERIF-2 — Corrige automatiquement les écarts détectés sur le dernier build mémorisé.", {
    backend: backendField,
  }, (a) => verify.autoRepair(bm, a.backend, () => cancelToken.cancelled));

  // ─────────────── 5.8 Sécurité du chantier ───────────────
  tool("create_checkpoint", "SAFE-1 — Sauvegarde l'état d'une zone avant modification (pour pouvoir l'annuler).", {
    corner1: Coord, corner2: Coord, id: z.string().optional(), frame: frameField,
  }, (a) => safe.createCheckpoint(bm, cfg.checkpointsDir, a.corner1, a.corner2, a.frame, a.id));

  tool("undo", "SAFE-2 — Restaure le dernier checkpoint (ou un id donné) : annule un build raté.", {
    id: z.string().optional(), backend: backendField,
  }, (a) => safe.undo(bm, cfg.checkpointsDir, a.backend, a.id, () => cancelToken.cancelled));

  // ─────────────── Contrôle d'exécution ───────────────
  tool("cancel_build", "Demande l'annulation coopérative de la primitive/blueprint en cours.", {}, () => {
    cancelToken.cancelled = true;
    setTimeout(() => (cancelToken.cancelled = false), 2000);
    return { status: "success", message: "Annulation demandée. La construction en cours va s'arrêter." } as ToolResult;
  }, false);
}
