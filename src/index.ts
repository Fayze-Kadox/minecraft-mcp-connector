#!/usr/bin/env node
// GARDE-FOU STDOUT : le canal stdout est STRICTEMENT réservé au JSON du
// protocole MCP. On redirige tout console.log/info/debug/warn (y compris ceux
// des dépendances) vers stderr, pour ne jamais corrompre le flux et éviter les
// « Unexpected token … is not valid JSON » côté Claude Desktop.
const toStderr = (...args: unknown[]) => process.stderr.write(args.map(String).join(" ") + "\n");
console.log = toStderr as typeof console.log;
console.info = toStderr as typeof console.info;
console.debug = toStderr as typeof console.debug;
console.warn = toStderr as typeof console.warn;

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
    version: "1.1.0",
  });

  registerAllTools(server, { bm, cfg, cancelToken: { cancelled: false } });

  // IMPORTANT : on NE se connecte PAS à Minecraft au démarrage. Le serveur MCP
  // démarre « à vide » et reste silencieux. La connexion se fait paresseusement
  // à la première action Minecraft (ou via l'outil connect). Si Minecraft est
  // fermé, aucune tentative n'est faite → aucun spam.
  const transport = new StdioServerTransport();
  await server.connect(transport);
  process.stderr.write(
    `[minecraft] Serveur MCP prêt (stdio). Connexion Minecraft à la demande ` +
      `(${cfg.minecraft.host}:${cfg.minecraft.port}).\n`
  );

  const shutdown = async () => {
    await bm.disconnect();
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

main().catch((e) => {
  process.stderr.write(`[minecraft] Erreur fatale: ${(e as Error).message}\n`);
  process.exit(1);
});
