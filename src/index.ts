#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { loadConfig } from "./config.js";
import { parseArgs, USAGE } from "./cli.js";
import { BotManager } from "./bot/botManager.js";
import { registerAllTools } from "./tools/registry.js";

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  if (argv.includes("--help")) {
    process.stdout.write(USAGE);
    return;
  }
  const cli = parseArgs(argv);
  const cfg = loadConfig(cli);
  const bm = new BotManager(cfg);

  const server = new McpServer({
    name: "minecraft-mcp-connector",
    version: "1.0.0",
  });

  registerAllTools(server, { bm, cfg, cancelToken: { cancelled: false } });

  // Tentative de connexion au démarrage ; en cas d'échec on laisse l'outil
  // "connect" réessayer (message d'erreur lisible côté agent).
  try {
    await bm.connect();
    // eslint-disable-next-line no-console
    console.error(`[mcp] Connecté à ${cfg.minecraft.host}:${cfg.minecraft.port} (${cfg.minecraft.version}).`);
  } catch (e) {
    // eslint-disable-next-line no-console
    console.error(`[mcp] Connexion initiale échouée : ${(e as Error).message}`);
    console.error(`[mcp] Le serveur MCP démarre quand même ; utilise l'outil "connect" une fois le monde ouvert.`);
  }

  const transport = new StdioServerTransport();
  await server.connect(transport);
  // eslint-disable-next-line no-console
  console.error("[mcp] Serveur MCP Minecraft prêt (stdio).");

  const shutdown = async () => {
    await bm.disconnect();
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

main().catch((e) => {
  // eslint-disable-next-line no-console
  console.error("Erreur fatale:", e);
  process.exit(1);
});
