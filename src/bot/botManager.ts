import mineflayer, { Bot } from "mineflayer";
import pathfinderPkg from "mineflayer-pathfinder";
import prismarineItem from "prismarine-item";
import { Vec3 } from "vec3";
import type { AppConfig } from "../config.js";
import { ToolError } from "../result.js";
import type { Coord } from "../coords.js";
import type {
  BlockPlacement,
  PlacementOutcome,
  ProgressCallback,
} from "./types.js";
import { normalizeBlockName, shortBlockName, compressToFillRuns } from "./blocks.js";

export { normalizeBlockName, shortBlockName, compressToFillRuns, dedupePlacements } from "./blocks.js";

const { pathfinder, Movements, goals } = pathfinderPkg;

export type Backend = "command" | "interact";

export interface BuildOptions {
  /** Backend de pose. "command" = /setblock & /fill (créatif + cheats). */
  backend?: Backend;
  onProgress?: ProgressCallback;
  /** Jeton d'annulation coopératif. */
  shouldCancel?: () => boolean;
}

export class BotManager {
  private bot: Bot | null = null;
  private connecting = false;
  private connected = false;
  private spawnPromise: Promise<void> | null = null;
  private intentionalQuit = false;

  constructor(private readonly cfg: AppConfig) {}

  // ───────────────────────── Connexion / cycle de vie ─────────────────────

  isConnected(): boolean {
    return this.connected && this.bot !== null;
  }

  /** Renvoie le bot connecté, ou lève une erreur actionnable. */
  require(): Bot {
    if (!this.bot || !this.connected) {
      throw new ToolError(
        "Bot non connecté au serveur Minecraft. Vérifie que le monde est ouvert en LAN, " +
          "que le host/port de la config sont corrects, puis relance la connexion."
      );
    }
    return this.bot;
  }

  async connect(): Promise<void> {
    if (this.connected) return;
    if (this.connecting && this.spawnPromise) return this.spawnPromise;

    this.connecting = true;
    this.intentionalQuit = false;
    const mc = this.cfg.minecraft;

    this.spawnPromise = new Promise<void>((resolve, reject) => {
      let settled = false;
      const bot = mineflayer.createBot({
        host: mc.host,
        port: mc.port,
        username: mc.username,
        auth: mc.auth,
        version: mc.version,
        // Évite le piège « nom ≠ compte » : en offline le username EST l'identité.
        checkTimeoutInterval: 30_000,
      });
      this.bot = bot;
      bot.loadPlugin(pathfinder);

      const fail = (msg: string) => {
        if (settled) return;
        settled = true;
        this.connecting = false;
        this.connected = false;
        reject(new ToolError(msg));
      };

      bot.once("spawn", () => {
        // Vérification de version lisible (NF 6.5).
        const v = bot.version;
        if (this.cfg.supportedVersions.length && !this.cfg.supportedVersions.includes(v)) {
          fail(
            `Version Minecraft "${v}" non supportée. Versions testées : ` +
              `${this.cfg.supportedVersions.join(", ")}. Ajuste "minecraft.version" / "supportedVersions" dans la config.`
          );
          try { bot.quit(); } catch { /* ignore */ }
          return;
        }
        try {
          const moves = new Movements(bot);
          moves.canDig = false; // ne pas creuser pour naviguer pendant un build
          bot.pathfinder.setMovements(moves);
        } catch { /* pathfinder optionnel */ }

        this.connected = true;
        this.connecting = false;
        if (!settled) {
          settled = true;
          resolve();
        }
      });

      bot.on("kicked", (reason) => {
        const r = typeof reason === "string" ? reason : JSON.stringify(reason);
        if (!settled) {
          fail(
            `Connexion refusée par le serveur (kick) : ${r}. ` +
              `Causes fréquentes : version incompatible, nom déjà utilisé, ou whitelist.`
          );
        } else {
          this.handleDisconnect(`kick: ${r}`);
        }
      });

      bot.on("error", (e: Error & { code?: string }) => {
        if (e.code === "ECONNREFUSED") {
          fail(
            `Connexion refusée à ${mc.host}:${mc.port} (ECONNREFUSED). ` +
              `Le serveur/monde LAN est-il bien ouvert sur ce port ?`
          );
        } else if (!settled) {
          fail(`Erreur de connexion : ${e.message}`);
        } else {
          this.handleDisconnect(`error: ${e.message}`);
        }
      });

      bot.on("end", (reason) => {
        this.handleDisconnect(`end: ${reason}`);
      });
    });

    return this.spawnPromise;
  }

  private handleDisconnect(reason: string): void {
    this.connected = false;
    this.bot = null;
    this.spawnPromise = null;
    if (this.intentionalQuit) return;
    if (this.cfg.bot.autoReconnect) {
      setTimeout(() => {
        this.connect().catch(() => { /* réessaie au prochain appel */ });
      }, this.cfg.bot.reconnectDelayMs);
    }
    // eslint-disable-next-line no-console
    console.error(`[botManager] Déconnecté (${reason}).`);
  }

  async disconnect(): Promise<void> {
    this.intentionalQuit = true;
    if (this.bot) {
      try { this.bot.quit(); } catch { /* ignore */ }
    }
    this.connected = false;
    this.bot = null;
  }

  // ───────────────────────── Perception bas niveau ───────────────────────

  /** Bloc à une position absolue, ou null si non chargé. */
  blockAt(c: Coord): ReturnType<Bot["blockAt"]> {
    return this.require().blockAt(new Vec3(c.x, c.y, c.z));
  }

  /**
   * Garantit que les chunks autour d'un point sont chargés en téléportant le bot
   * à proximité si nécessaire (créatif + cheats). Indispensable pour scanner/poser
   * loin du bot.
   */
  async ensureLoaded(c: Coord, backend: Backend = "command"): Promise<void> {
    const bot = this.require();
    const here = bot.blockAt(new Vec3(c.x, c.y, c.z));
    if (here) return;
    if (backend === "command") {
      await this.runCommand(`tp @s ${c.x} ${c.y + 2} ${c.z}`);
      await this.waitTicks(5);
    } else {
      try {
        await bot.pathfinder.goto(new goals.GoalNear(c.x, c.y, c.z, 4));
      } catch { /* best effort */ }
    }
  }

  waitTicks(ticks: number): Promise<void> {
    const bot = this.require();
    return new Promise((resolve) => {
      let n = 0;
      const onTick = () => {
        if (++n >= ticks) {
          bot.removeListener("physicsTick", onTick);
          resolve();
        }
      };
      bot.on("physicsTick", onTick);
    });
  }

  private delay(ms: number): Promise<void> {
    return new Promise((r) => setTimeout(r, ms));
  }

  // ───────────────────────── Commandes serveur ───────────────────────────

  /** Envoie une commande (sans le « / » initial). Nécessite les cheats. */
  async runCommand(cmd: string): Promise<void> {
    const bot = this.require();
    bot.chat(`/${cmd}`);
    // Petit délai pour laisser le serveur traiter et éviter le spam.
    await this.delay(Math.max(5, Math.floor(this.cfg.bot.placeIntervalMs / 4)));
  }

  detectGameMode(): "creative" | "survival" | "adventure" | "spectator" | "unknown" {
    const bot = this.bot;
    if (!bot) return "unknown";
    const gm = (bot.game?.gameMode as string) ?? "unknown";
    return (gm as any) ?? "unknown";
  }

  // ───────────────────────── Moteur de pose ──────────────────────────────

  /**
   * Pose un ensemble de blocs de façon déterministe et par lots.
   * - backend "command" : compresse en /fill les segments contigus de même type,
   *   sinon /setblock, le tout cadencé (anti-kick).
   * - backend "interact" : pose physique via Mineflayer (survie).
   * N'effectue JAMAIS un aller-retour MCP par bloc : tout est interne.
   */
  async placeBlocks(
    placements: BlockPlacement[],
    opts: BuildOptions = {}
  ): Promise<PlacementOutcome> {
    const backend = opts.backend ?? "command";
    const total = placements.length;

    if (total > this.cfg.bot.maxBlocksPerPrimitive) {
      throw new ToolError(
        `Garde-fou volume : ${total} blocs demandés > limite ${this.cfg.bot.maxBlocksPerPrimitive}. ` +
          `Découpe la construction ou augmente "bot.maxBlocksPerPrimitive".`
      );
    }
    if (total === 0) {
      return { requested: 0, placed: 0, failures: [], cancelled: false };
    }

    return backend === "command"
      ? this.placeViaCommands(placements, opts)
      : this.placeViaInteract(placements, opts);
  }

  private async placeViaCommands(
    placements: BlockPlacement[],
    opts: BuildOptions
  ): Promise<PlacementOutcome> {
    // Charge les chunks autour de la zone (un point suffit en pratique).
    await this.ensureLoaded(placements[0].pos, "command");

    const runs = compressToFillRuns(placements);
    let placed = 0;
    const failures: Coord[] = [];
    let processed = 0;
    const total = placements.length;

    for (const run of runs) {
      if (opts.shouldCancel?.()) {
        return { requested: total, placed, failures, cancelled: true };
      }
      const type = normalizeBlockName(run.type);
      try {
        if (run.kind === "fill") {
          // /fill plafonne à 32768 blocs/commande en vanilla — déjà borné en amont.
          await this.runCommand(
            `fill ${run.min.x} ${run.min.y} ${run.min.z} ${run.max.x} ${run.max.y} ${run.max.z} ${type}`
          );
        } else {
          await this.runCommand(`setblock ${run.pos.x} ${run.pos.y} ${run.pos.z} ${type}`);
        }
        placed += run.count;
      } catch {
        if (run.kind === "fill") {
          for (let x = run.min.x; x <= run.max.x; x++)
            for (let y = run.min.y; y <= run.max.y; y++)
              for (let z = run.min.z; z <= run.max.z; z++) failures.push({ x, y, z });
        } else {
          failures.push(run.pos);
        }
      }
      processed += run.count;
      opts.onProgress?.({ done: processed, total });
      await this.delay(this.cfg.bot.placeIntervalMs);
    }

    return { requested: total, placed, failures, cancelled: false };
  }

  private async placeViaInteract(
    placements: BlockPlacement[],
    opts: BuildOptions
  ): Promise<PlacementOutcome> {
    const bot = this.require();
    let placed = 0;
    const failures: Coord[] = [];
    const total = placements.length;

    for (let i = 0; i < placements.length; i++) {
      if (opts.shouldCancel?.()) {
        return { requested: total, placed, failures, cancelled: true };
      }
      const p = placements[i];
      try {
        await this.interactPlaceOne(p);
        placed++;
      } catch {
        failures.push(p.pos);
      }
      opts.onProgress?.({ done: i + 1, total });
      await this.delay(this.cfg.bot.placeIntervalMs);
    }
    void bot;
    return { requested: total, placed, failures, cancelled: false };
  }

  private async interactPlaceOne(p: BlockPlacement): Promise<void> {
    const bot = this.require();
    const target = new Vec3(p.pos.x, p.pos.y, p.pos.z);

    // Se rapprocher si hors de portée.
    if (bot.entity.position.distanceTo(target) > this.cfg.bot.reach) {
      await bot.pathfinder.goto(new goals.GoalNear(p.pos.x, p.pos.y, p.pos.z, 2));
    }

    // En créatif, garantir l'item en main.
    const itemName = shortBlockName(p.type);
    const mcData = bot.registry as any;
    const item = mcData.itemsByName[itemName];
    if (!item) throw new ToolError(`Item inconnu pour le bloc "${p.type}".`);

    if (this.detectGameMode() === "creative") {
      const ItemCtor = (bot as any).registry?.Item ?? null;
      void ItemCtor;
      await bot.creative.setInventorySlot(36, mcDataItem(bot, itemName));
    }
    await bot.equip(item.id, "hand");

    // Trouver un bloc de référence adjacent solide.
    const dirs = [
      new Vec3(0, -1, 0), new Vec3(0, 1, 0),
      new Vec3(1, 0, 0), new Vec3(-1, 0, 0),
      new Vec3(0, 0, 1), new Vec3(0, 0, -1),
    ];
    for (const d of dirs) {
      const ref = bot.blockAt(target.minus(d));
      if (ref && ref.boundingBox === "block") {
        await bot.placeBlock(ref, d);
        return;
      }
    }
    throw new ToolError(
      `Pas de bloc de référence adjacent pour poser à (${p.pos.x},${p.pos.y},${p.pos.z}). ` +
        `En survie, construis depuis une surface existante ou utilise le backend "command".`
    );
  }

  /** Casse un bloc (backend command = /setblock air ; interact = dig). */
  async breakBlocks(coords: Coord[], opts: BuildOptions = {}): Promise<PlacementOutcome> {
    const placements: BlockPlacement[] = coords.map((pos) => ({ pos, type: "air" }));
    if ((opts.backend ?? "command") === "command") {
      return this.placeBlocks(placements, opts);
    }
    // interact : dig
    const bot = this.require();
    let placed = 0;
    const failures: Coord[] = [];
    for (let i = 0; i < coords.length; i++) {
      if (opts.shouldCancel?.()) return { requested: coords.length, placed, failures, cancelled: true };
      const c = coords[i];
      try {
        const blk = bot.blockAt(new Vec3(c.x, c.y, c.z));
        if (blk && blk.name !== "air") {
          if (bot.entity.position.distanceTo(new Vec3(c.x, c.y, c.z)) > this.cfg.bot.reach) {
            await bot.pathfinder.goto(new goals.GoalNear(c.x, c.y, c.z, 2));
          }
          await bot.dig(blk);
        }
        placed++;
      } catch {
        failures.push(c);
      }
      opts.onProgress?.({ done: i + 1, total: coords.length });
      await this.delay(this.cfg.bot.placeIntervalMs);
    }
    return { requested: coords.length, placed, failures, cancelled: false };
  }
}

function mcDataItem(bot: Bot, itemName: string) {
  const Item = (prismarineItem as any)(bot.version);
  const data = (bot.registry as any).itemsByName[itemName];
  return new Item(data.id, 64);
}
