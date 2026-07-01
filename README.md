# Connecteur Minecraft intelligent pour Claude (serveur MCP)

Serveur **MCP** (Model Context Protocol) qui donne à un agent LLM (Claude Desktop ou API Anthropic) des « mains et des yeux » fiables dans **Minecraft Java Edition** : primitives géométriques haut niveau exécutées de façon déterministe côté serveur, système de **blueprints**, perception riche, et boucle de **vérification / auto-correction**.

Le principe directeur : *le serveur est les mains et les yeux ; le LLM est le cerveau.* On déplace l'exécution déterministe (enchaînement des poses, déplacements, comptes rendus) vers ce connecteur, pour que l'agent planifie au lieu de micro-gérer bloc par bloc — ce qui élimine l'erreur cumulée sur les grosses structures.

## Sommaire

- [Architecture](#architecture)
- [Prérequis](#prérequis)
- [Installation express (recommandée, zéro configuration)](#installation-express-recommandée-zéro-configuration)
- [Préparer le monde Minecraft (LAN)](#préparer-le-monde-minecraft-lan)
- [Installation manuelle (développement)](#installation-manuelle-développement)
- [Configuration](#configuration)
- [Brancher Claude Desktop](#brancher-claude-desktop)
- [Backends de pose : `command` vs `interact`](#backends-de-pose)
- [Convention de coordonnées](#convention-de-coordonnées)
- [Catalogue d'outils](#catalogue-doutils) — voir aussi [`docs/tools.md`](docs/tools.md)
- [Blueprints](#blueprints) — voir aussi [`docs/blueprint-format.md`](docs/blueprint-format.md)
- [Tests](#tests)
- [Dépannage](#dépannage)
- [Sécurité](#sécurité) — voir aussi [`docs/SECURITY.md`](docs/SECURITY.md)

## Architecture

```
┌──────────────┐   MCP (stdio)   ┌─────────────────────┐  Protocole MC  ┌─────────────┐
│   Claude     │ ──────────────► │  Connecteur MCP     │ ─────────────► │  Serveur    │
│(Desktop/API) │ ◄── JSON ────── │  (ce projet)        │ ◄── monde ──── │  Minecraft  │
└──────────────┘                 │  MCP / logique / bot│                │  (LAN/local)│
                                 └─────────────────────┘                └─────────────┘
```

Trois couches, reflétées par l'arborescence `src/` :

| Couche | Dossier | Rôle |
|--------|---------|------|
| **MCP** | `src/tools/`, `src/index.ts` | Déclaration des outils, schémas typés (zod), sérialisation JSON |
| **Logique** | `src/geometry/`, `src/blueprint/`, `src/verify/`, `src/safety/`, `src/resources/` | Moteur géométrique pur, blueprints, vérification, checkpoints |
| **Bot** | `src/bot/`, `src/perception/`, `src/actions/` | Wrapper Mineflayer : connexion, pose/casse, lecture du monde |

## Prérequis

- **Node.js 20 ou 22** (LTS). Vérifie avec `node -v`.
- **Minecraft Java Edition 1.21.x** (versions testées : 1.21 → 1.21.4).
- Un monde ouvert en **LAN** avec les **cheats activés** (pour le backend `command`, recommandé), ou un serveur dédié local.

## Installation express (recommandée, zéro configuration)

Aucun clone, aucun `npm install`, aucun build manuel. Colle **un seul bloc** dans
`claude_desktop_config.json` (menu Claude Desktop → Paramètres → Développeur →
Modifier la config) :

```json
{
  "mcpServers": {
    "minecraft": {
      "command": "npx",
      "args": [
        "-y", "github:Fayze-Kadox/minecraft-mcp-connector",
        "--host", "127.0.0.1",
        "--port", "25565",
        "--username", "ClaudeBot",
        "--version", "1.21.4"
      ]
    }
  }
}
```

Au premier lancement, `npx` télécharge le dépôt, installe les dépendances et
**compile automatiquement** (script `prepare`), puis démarre le connecteur. Les
lancements suivants réutilisent le cache. Le backend `command` (`/setblock` &
`/fill`) est utilisé par défaut — parfait pour un monde créatif avec cheats.

Options CLI disponibles (toutes optionnelles, avec des valeurs par défaut) :

| Option | Défaut | Description |
|--------|--------|-------------|
| `--host` | `127.0.0.1` | Hôte du serveur Minecraft |
| `--port` | `25565` | Port LAN/serveur |
| `--username` | `ClaudeBot` | Nom du bot |
| `--auth` | `offline` | `offline` (LAN) ou `microsoft` |
| `--version` | `1.21.4` | Version Minecraft |
| `--backend` | `command` | `command` (cheats) ou `interact` (survie) |
| `--place-interval` | `40` | Cadence anti-kick entre poses (ms) |
| `--max-blocks` | `200000` | Garde-fou volume par primitive |

Les variables d'environnement équivalentes fonctionnent aussi (`MC_HOST`,
`MC_PORT`, `MC_USERNAME`, `MC_AUTH`, `MC_VERSION`, `MC_BACKEND`).

> Astuce : `npx -y github:Fayze-Kadox/minecraft-mcp-connector --help` affiche
> l'aide et la liste des options.

## Préparer le monde Minecraft (LAN)

1. Lance Minecraft Java **1.21.x** et ouvre un monde **solo en mode Créatif**.
2. Active les cheats : *Échap → Ouvrir sur le réseau local → « Autoriser les codes (cheats) : Oui »* → **Démarrer le monde en réseau local**.
3. Note le **port** affiché dans le chat (ex. `Partie locale hébergée sur le port 49215`).
4. Reporte ce port dans l'argument `--port` (installation express) ou dans `config.json` (installation manuelle).

> Le bot rejoint comme un second joueur. En **offline/LAN**, le `username` configuré EST l'identité du bot — choisis un nom simple (ex. `ClaudeBot`) pour éviter le piège classique « nom ≠ compte » qui provoque des kicks.

## Installation manuelle (développement)

Utile seulement pour développer/modifier le connecteur. Pour un usage normal,
préfère l'[installation express](#installation-express-recommandée-zéro-configuration).

```bash
git clone https://github.com/Fayze-Kadox/minecraft-mcp-connector.git
cd minecraft-mcp-connector
npm install          # le script "prepare" compile déjà dist/ automatiquement
npm run build        # (au besoin) recompile TypeScript → dist/
npm run dev          # lancement direct sans build, via tsx
```

Tu peux alors lancer le serveur avec les mêmes arguments qu'en express :
`node dist/index.js --host 127.0.0.1 --port 25565 --username ClaudeBot`.

## Configuration par fichier (optionnelle)

Le connecteur démarre sans aucun fichier grâce aux arguments CLI. Un `config.json`
reste possible comme **fallback** (précédence : défauts < `config.json` < variables
d'env < arguments CLI). Copie l'exemple puis édite :

```bash
cp config.example.json config.json
```

```jsonc
{
  "minecraft": {
    "host": "127.0.0.1",
    "port": 25565,          // ← le port LAN affiché par Minecraft
    "username": "ClaudeBot",
    "auth": "offline",      // "offline" pour LAN ; "microsoft" pour un compte
    "version": "1.21.4"
  },
  "supportedVersions": ["1.21", "1.21.1", "1.21.2", "1.21.3", "1.21.4"],
  "bot": {
    "placeIntervalMs": 40,        // cadence anti-kick entre commandes de pose
    "maxBlocksPerPrimitive": 200000,  // garde-fou volume
    "reach": 4.5,                 // portée (backend interact)
    "autoReconnect": true,
    "reconnectDelayMs": 5000
  },
  "blueprintsDir": "./blueprints",
  "checkpointsDir": "./checkpoints",
  "disabledTools": []             // ex. ["gather"] pour désactiver des outils
}
```

Les secrets ne sont **jamais** écrits en clair : on peut surcharger la connexion par variables d'environnement `MC_HOST`, `MC_PORT`, `MC_USERNAME`, `MC_AUTH`, `MC_VERSION`. `config.json` est ignoré par git.

## Brancher Claude Desktop

La méthode recommandée est le bloc `npx` de l'[installation express](#installation-express-recommandée-zéro-configuration).

Si tu as fait l'installation manuelle, pointe plutôt Claude Desktop sur le build local :

```json
{
  "mcpServers": {
    "minecraft": {
      "command": "node",
      "args": [
        "C:/chemin/vers/minecraft-mcp-connector/dist/index.js",
        "--host", "127.0.0.1", "--port", "25565",
        "--username", "ClaudeBot", "--version", "1.21.4"
      ]
    }
  }
}
```

Un chemin de `config.json` peut aussi être passé en argument positionnel ; sinon le serveur cherche `./config.json` puis la variable `MCP_MC_CONFIG`.

Redémarre Claude Desktop : les outils Minecraft apparaissent. Demande par exemple : *« Connecte-toi et construis une maison 7×7 en chêne devant toi. »*

## Backends de pose

| Backend | Mécanisme | Avantages | Requiert |
|---------|-----------|-----------|----------|
| `command` *(défaut)* | `/setblock` & `/fill` | Déterministe, rapide, pas de pathfinding, idéal gros volumes | Créatif + **cheats activés** |
| `interact` | Pose physique Mineflayer (`placeBlock`/`dig`) | Fonctionne sans cheats, survie | Surface d'appui adjacente, déplacement |

Le moteur **compresse automatiquement** les poses contiguës de même type en commandes `/fill`, ce qui réduit drastiquement le nombre de commandes (un mur plein = 1 commande). Aucune primitive ne fait d'aller-retour MCP par bloc : tout est enchaîné en interne et seul un résultat agrégé est renvoyé.

## Connexion et stabilité

Le connecteur démarre **sans se connecter** à Minecraft : il reste silencieux et
disponible. La connexion se fait **paresseusement** à la première action
Minecraft (ou via l'outil `connect`). Si Minecraft est fermé, aucune tentative
n'est faite — donc **aucun spam d'erreurs**. Tous les logs partent sur `stderr`
uniquement (jamais sur `stdout`, réservé au protocole MCP).

En cas de déconnexion réelle après coup, la reconnexion est **bornée** : backoff
exponentiel (5s, 10s, 20s…), plafonné à 5 tentatives, sans chevauchement. Au-delà,
le bot reste déconnecté proprement jusqu'au prochain appel d'outil ou `connect`.

## Feedback in-game

Par défaut, le bot poste un petit résumé dans le **chat Minecraft** au fil des
actions (primitives, blueprints, vérification, réparation) :

```
🏗️ Blueprint 'petite_maison' : construction de 213 blocs…
✅ Blueprint 'petite_maison' construit (213 blocs)
🔍 Vérification blueprint:petite_maison : 100% conforme (0 écart(s))
⚠️ fill_region(hollow) : 96/100 blocs (4 manquants)
🔧 Réparation : 4 bloc(s) corrigé(s) — 100% conforme
```

Pour désactiver : `--chat-feedback false` (ou `"chatFeedback": false` dans la
config, ou `MC_CHAT_FEEDBACK=false`).

## Convention de coordonnées

Toutes les primitives acceptent un champ `frame` :

- **`absolute`** *(défaut)* — coordonnées monde Minecraft.
- **`relative`** — relatives à la position du bot (sans rotation).
- **`local`** — relatives à la position **et** à l'orientation du bot : `+z` = devant, `+x` = droite, `+y` = haut (rotations cardinales uniquement). Pratique pour « un mur 5 blocs devant moi ».

## Catalogue d'outils

Résumé (détail complet dans [`docs/tools.md`](docs/tools.md)) :

- **Perception** : `get_position`, `get_blocks_around`, `get_block_at`, `scan_region`, `get_inventory`, `get_nearby_entities`, `find_blocks`, `raycast`.
- **Navigation** : `goto`, `look_at`, `follow_player`, `stop`.
- **Bas niveau** : `place_block`, `break_block`, `use_item`.
- **Primitives haut niveau** : `fill_region`, `draw_line`, `build_wall`, `build_floor_ceiling`, `build_box`, `build_sphere`, `build_cylinder`, `build_pyramid`, `build_stairs`, `clear_region`, `replace_blocks`.
- **Blueprints** : `build_blueprint`, `save_blueprint`, `load_blueprint`, `list_blueprints`, `capture_blueprint`.
- **Ressources** : `ensure_materials`, `set_creative_inventory`, `gather`.
- **Vérification** : `verify_build`, `auto_repair`.
- **Sécurité chantier** : `create_checkpoint`, `undo`.
- **Divers** : `connect`, `disconnect`, `get_status`, `cancel_build`.

Chaque outil renvoie un JSON `{ status: "success"|"partial"|"error", message, data }`, avec des messages d'erreur **actionnables**.

## Blueprints

Un blueprint décrit une structure complète, soit par **couches de symboles + palette**, soit par **primitives composées**. Le serveur calcule l'ordre de pose (bas → haut) et construit en un appel. Spécification complète et exemples : [`docs/blueprint-format.md`](docs/blueprint-format.md). Exemples prêts à l'emploi dans [`blueprints/`](blueprints/).

## Tests

```bash
npm test            # Vitest : géométrie + blueprints (logique pure)
```

Les tests unitaires couvrent le moteur géométrique et la compilation de blueprints sans serveur Minecraft. Les scénarios de recette nécessitant un monde réel sont décrits dans [`docs/acceptance-tests.md`](docs/acceptance-tests.md).

## Dépannage

| Symptôme | Cause probable | Solution |
|----------|----------------|----------|
| `ECONNREFUSED` | Monde non ouvert / mauvais port | Ré-ouvre en LAN, copie le port exact dans `config.json` |
| Reste bloqué en « connexion » | Version incompatible | Le connecteur renvoie maintenant un message clair ; aligne `minecraft.version` sur la version du monde |
| Kick immédiat | Nom déjà utilisé / whitelist | Change `username` ; en LAN privé, désactive la whitelist |
| `fill_region` sans effet | Cheats désactivés (backend `command`) | Active les cheats, ou passe `backend: "interact"` |
| Blocs non posés loin du bot | Chunks non chargés | Le connecteur téléporte/approche le bot automatiquement (cheats requis pour le tp) |

## Sécurité

Usage **local et privé** par défaut. Lis [`docs/SECURITY.md`](docs/SECURITY.md) avant tout usage sur un serveur partagé. Aucune exécution de code arbitraire n'est exposée. Les volumes sont bornés (`maxBlocksPerPrimitive`) pour éviter de faire planter le serveur.

## Licence

MIT.
