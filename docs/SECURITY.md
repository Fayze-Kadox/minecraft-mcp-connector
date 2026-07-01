# Note de sécurité et limites d'usage

Ce connecteur est conçu pour un usage **local et privé**. Lis cette note avant
tout autre usage.

## Périmètre d'usage prévu

- Monde solo Minecraft Java ouvert en **LAN**, ou serveur dédié **local**, sur la
  machine de l'utilisateur ou son réseau privé de confiance.
- Mode **créatif** prioritaire (le backend `command` requiert les cheats).

## Risques sur un serveur partagé

Sur un serveur multijoueur partagé, l'agent peut **modifier le monde d'autres
joueurs** (poser/casser des milliers de blocs, vider des zones). N'utilise ce
connecteur sur un serveur partagé qu'avec :

- l'accord explicite des administrateurs ;
- des **limites de zone** convenues à l'avance ;
- de préférence un compte/role aux permissions restreintes.

Le backend `command` nécessite les **cheats / droits d'opérateur** : ne donne ces
droits au bot que sur un monde que tu contrôles.

## Garde-fous intégrés

- **Limite de volume** : `bot.maxBlocksPerPrimitive` (défaut 200 000) empêche un
  `fill_region` géant de saturer le serveur. Toute primitive dépassant la limite
  est refusée avec un message clair.
- **Limites de scan** : `scan_region`, `create_checkpoint` plafonnent à ~500 000
  blocs.
- **Cadence de pose** configurable (`placeIntervalMs`) pour éviter les kicks par
  spam de commandes.
- **Annulation coopérative** (`cancel_build`) et **checkpoints/undo** pour
  revenir en arrière.
- **Désactivation d'outils** : `disabledTools` permet de retirer des outils
  sensibles (ex. `gather`, `clear_region`).

## Secrets et configuration

- **Aucune clé API en clair** dans le code. La connexion peut être fournie par
  variables d'environnement (`MC_HOST`, `MC_PORT`, `MC_USERNAME`, `MC_AUTH`,
  `MC_VERSION`).
- `config.json`, `.env` et `secrets.json` sont **ignorés par git** (`.gitignore`).
- En mode `offline` (LAN), le `username` configuré est l'identité du bot : il
  n'y a pas d'authentification forte — n'expose pas ce monde à Internet.

## Exécution de code arbitraire

Ce connecteur **n'expose aucun outil d'exécution de code arbitraire** ni de
commande shell. Il n'envoie au serveur Minecraft que des commandes de
construction délimitées (`/setblock`, `/fill`, `/tp` du bot). Si une telle
fonctionnalité était ajoutée à l'avenir, elle devrait être **désactivée par
défaut** et **sandboxée** (ex. conteneur Docker).

## Réseau

- Le connecteur communique avec Claude via **stdio** (aucun port réseau ouvert
  côté MCP par défaut).
- Il se connecte uniquement à l'hôte/port Minecraft configuré. Garde cet hôte sur
  `127.0.0.1` ou ton réseau local.
