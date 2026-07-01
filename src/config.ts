import { readFileSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import type { CliOptions } from "./cli.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

export interface AppConfig {
  minecraft: {
    host: string;
    port: number;
    username: string;
    auth: "offline" | "microsoft";
    version: string;
  };
  supportedVersions: string[];
  bot: {
    /** Délai entre deux poses, en ms (cadence anti-kick). */
    placeIntervalMs: number;
    /** Garde-fou : nombre max de blocs traités par une primitive. */
    maxBlocksPerPrimitive: number;
    scanIntervalMs: number;
    /** Portée de pose/casse en blocs. */
    reach: number;
    /** Backend de pose par défaut si l'outil n'en précise pas. */
    defaultBackend: "command" | "interact";
    autoReconnect: boolean;
    reconnectDelayMs: number;
  };
  blueprintsDir: string;
  checkpointsDir: string;
  /** Envoie des messages de suivi dans le chat Minecraft (feedback in-game). */
  chatFeedback: boolean;
  /** Noms d'outils MCP à désactiver (sécurité). */
  disabledTools: string[];
}

const DEFAULT_CONFIG: AppConfig = {
  minecraft: {
    host: "127.0.0.1",
    port: 25565,
    username: "ClaudeBot",
    auth: "offline",
    version: "1.21.4",
  },
  supportedVersions: ["1.21", "1.21.1", "1.21.2", "1.21.3", "1.21.4"],
  bot: {
    placeIntervalMs: 40,
    maxBlocksPerPrimitive: 200000,
    scanIntervalMs: 0,
    reach: 4.5,
    defaultBackend: "command",
    autoReconnect: true,
    reconnectDelayMs: 5000,
  },
  blueprintsDir: "./blueprints",
  checkpointsDir: "./checkpoints",
  chatFeedback: true,
  disabledTools: [],
};

function deepMerge<T>(base: T, override: Partial<T>): T {
  const out: any = Array.isArray(base) ? [...(base as any)] : { ...base };
  for (const key of Object.keys(override ?? {})) {
    const ov = (override as any)[key];
    const bv = (base as any)[key];
    if (ov && typeof ov === "object" && !Array.isArray(ov) && bv && typeof bv === "object") {
      out[key] = deepMerge(bv, ov);
    } else if (ov !== undefined) {
      out[key] = ov;
    }
  }
  return out;
}

/**
 * Charge la config selon la précédence (faible → fort) :
 *   1. valeurs par défaut ;
 *   2. config.json (via --config, MCP_MC_CONFIG, ou ./config.json — OPTIONNEL) ;
 *   3. variables d'environnement (MC_HOST, MC_PORT, …) ;
 *   4. arguments CLI (--host, --port, …).
 *
 * Aucun fichier n'est requis : le connecteur démarre avec les seules valeurs
 * par défaut + arguments passés par Claude Desktop.
 */
export function loadConfig(cli: CliOptions = {}): AppConfig {
  const candidatePaths = [
    cli.config,
    process.env.MCP_MC_CONFIG,
    resolve(__dirname, "..", "config.json"),
  ].filter(Boolean) as string[];

  let cfg: AppConfig = DEFAULT_CONFIG;
  for (const p of candidatePaths) {
    if (p && existsSync(p)) {
      const raw = JSON.parse(readFileSync(p, "utf8"));
      cfg = deepMerge(DEFAULT_CONFIG, raw);
      break;
    }
  }

  // 3. Variables d'environnement.
  if (process.env.MC_HOST) cfg.minecraft.host = process.env.MC_HOST;
  if (process.env.MC_PORT) cfg.minecraft.port = Number(process.env.MC_PORT);
  if (process.env.MC_USERNAME) cfg.minecraft.username = process.env.MC_USERNAME;
  if (process.env.MC_AUTH) cfg.minecraft.auth = process.env.MC_AUTH as "offline" | "microsoft";
  if (process.env.MC_VERSION) cfg.minecraft.version = process.env.MC_VERSION;
  if (process.env.MC_BACKEND) cfg.bot.defaultBackend = process.env.MC_BACKEND as "command" | "interact";
  if (process.env.MC_CHAT_FEEDBACK) cfg.chatFeedback = /^(1|true|yes|on)$/i.test(process.env.MC_CHAT_FEEDBACK);

  // 4. Arguments CLI (précédence maximale).
  if (cli.host !== undefined) cfg.minecraft.host = cli.host;
  if (cli.port !== undefined) cfg.minecraft.port = cli.port;
  if (cli.username !== undefined) cfg.minecraft.username = cli.username;
  if (cli.auth !== undefined) cfg.minecraft.auth = cli.auth;
  if (cli.version !== undefined) cfg.minecraft.version = cli.version;
  if (cli.backend !== undefined) cfg.bot.defaultBackend = cli.backend;
  if (cli.placeIntervalMs !== undefined) cfg.bot.placeIntervalMs = cli.placeIntervalMs;
  if (cli.maxBlocks !== undefined) cfg.bot.maxBlocksPerPrimitive = cli.maxBlocks;
  if (cli.chatFeedback !== undefined) cfg.chatFeedback = cli.chatFeedback;

  return cfg;
}
