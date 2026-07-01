/**
 * Parse les arguments CLI passés au connecteur (via npx/Claude Desktop).
 * Exemple :
 *   npx -y github:Fayze-Kadox/minecraft-mcp-connector \
 *       --host 127.0.0.1 --port 25565 --username ClaudeBot --version 1.21.4
 *
 * Précédence de configuration (du plus faible au plus fort) :
 *   valeurs par défaut < config.json < variables d'environnement < arguments CLI
 */

export interface CliOptions {
  config?: string;
  host?: string;
  port?: number;
  username?: string;
  auth?: "offline" | "microsoft";
  version?: string;
  backend?: "command" | "interact";
  placeIntervalMs?: number;
  maxBlocks?: number;
}

/** Alias acceptés → clé canonique. */
const FLAG_ALIASES: Record<string, keyof CliOptions> = {
  "--config": "config",
  "--host": "host",
  "-h": "host",
  "--port": "port",
  "-p": "port",
  "--username": "username",
  "--user": "username",
  "-u": "username",
  "--auth": "auth",
  "--version": "version",
  "-v": "version",
  "--backend": "backend",
  "-b": "backend",
  "--place-interval": "placeIntervalMs",
  "--place-interval-ms": "placeIntervalMs",
  "--max-blocks": "maxBlocks",
};

const NUMERIC = new Set<keyof CliOptions>(["port", "placeIntervalMs", "maxBlocks"]);

/**
 * Parse `argv` (sans les deux premiers éléments node/script).
 * Gère `--flag value`, `--flag=value`, et un éventuel chemin de config positionnel.
 */
export function parseArgs(argv: string[]): CliOptions {
  const out: CliOptions = {};
  for (let i = 0; i < argv.length; i++) {
    let token = argv[i];
    if (!token.startsWith("-")) {
      // Argument positionnel : chemin de config (rétrocompatibilité).
      if (!out.config) out.config = token;
      continue;
    }

    let value: string | undefined;
    const eq = token.indexOf("=");
    if (eq !== -1) {
      value = token.slice(eq + 1);
      token = token.slice(0, eq);
    }

    const key = FLAG_ALIASES[token];
    if (!key) continue; // flag inconnu ignoré silencieusement

    if (value === undefined) {
      // valeur = token suivant (sauf si c'est un autre flag)
      const next = argv[i + 1];
      if (next !== undefined && !next.startsWith("--")) {
        value = next;
        i++;
      }
    }
    if (value === undefined) continue;

    if (NUMERIC.has(key)) {
      const n = Number(value);
      if (!Number.isNaN(n)) (out as any)[key] = n;
    } else {
      (out as any)[key] = value;
    }
  }
  return out;
}

/** Aide affichée avec --help. */
export const USAGE = `minecraft-mcp-connector — serveur MCP Minecraft pour Claude

Usage (via Claude Desktop / npx) :
  npx -y github:Fayze-Kadox/minecraft-mcp-connector [options]

Options :
  --host <ip>            Hôte du serveur Minecraft (défaut 127.0.0.1)
  --port <n>             Port LAN/serveur (défaut 25565)
  --username <nom>       Nom du bot (défaut ClaudeBot)
  --auth <offline|microsoft>  Mode d'authentification (défaut offline)
  --version <x.y.z>      Version Minecraft (défaut 1.21.4)
  --backend <command|interact>  Backend de pose par défaut (défaut command)
  --place-interval <ms>  Cadence entre poses (défaut 40)
  --max-blocks <n>       Garde-fou volume par primitive (défaut 200000)
  --config <chemin>      Fichier config.json optionnel (fallback)

Variables d'environnement équivalentes : MC_HOST, MC_PORT, MC_USERNAME, MC_AUTH, MC_VERSION.
`;
