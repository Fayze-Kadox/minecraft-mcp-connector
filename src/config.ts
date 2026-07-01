import { readFileSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

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
    autoReconnect: boolean;
    reconnectDelayMs: number;
  };
  blueprintsDir: string;
  checkpointsDir: string;
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
    autoReconnect: true,
    reconnectDelayMs: 5000,
  },
  blueprintsDir: "./blueprints",
  checkpointsDir: "./checkpoints",
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
 * Charge la config depuis (par ordre de priorité) :
 *  1. le chemin passé en argument ou la variable d'env MCP_MC_CONFIG ;
 *  2. ./config.json à la racine du projet ;
 *  3. valeurs par défaut.
 * Les variables d'environnement MC_HOST / MC_PORT / MC_USERNAME / MC_AUTH / MC_VERSION
 * surchargent ensuite la connexion (utile pour ne pas écrire les secrets en clair).
 */
export function loadConfig(explicitPath?: string): AppConfig {
  const candidatePaths = [
    explicitPath,
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

  // Surcharge par variables d'environnement.
  if (process.env.MC_HOST) cfg.minecraft.host = process.env.MC_HOST;
  if (process.env.MC_PORT) cfg.minecraft.port = Number(process.env.MC_PORT);
  if (process.env.MC_USERNAME) cfg.minecraft.username = process.env.MC_USERNAME;
  if (process.env.MC_AUTH) cfg.minecraft.auth = process.env.MC_AUTH as "offline" | "microsoft";
  if (process.env.MC_VERSION) cfg.minecraft.version = process.env.MC_VERSION;

  return cfg;
}
