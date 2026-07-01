# Scénarios de recette (section 8 du cahier des charges)

Les tests unitaires automatisés (`npm test`) couvrent la logique pure (géométrie,
compression `/fill`, compilation de blueprints, repères de coordonnées). Les
scénarios ci-dessous nécessitent un **monde Minecraft 1.21.x réel** (LAN, créatif,
cheats) et se jouent via les outils MCP, par l'agent ou manuellement.

| # | Scénario | Procédure | Critère de réussite |
|---|----------|-----------|---------------------|
| 1 | **Connexion** | `connect` avec bon port ; puis avec mauvais port ; puis avec version non supportée | Connexion OK ; sinon message explicite (`ECONNREFUSED…`, `version "X" non supportée…`) — jamais de blocage en « connexion en cours » |
| 2 | **Perception** | Poser manuellement quelques blocs connus, puis `scan_region` sur la zone | La grille RLE renvoyée correspond exactement à l'état réel |
| 3 | **Primitive simple** | `fill_region` d'une boîte 10×10×10 en `mode: hollow` | 100 % conforme (`verify_build`), **un seul** appel MCP, aucun kick |
| 4 | **Géométrie** | `build_sphere` rayon 8 `hollow:true` puis `verify_build` | Forme correcte, conformité 100 % |
| 5 | **Blueprint** | `build_blueprint` de `blueprints/petite_maison.json` (≥ 2 couches, porte, fenêtres) | Conformité ≥ 99 %, rapport d'écarts fourni |
| 6 | **Auto-correction** | Casser manuellement une partie du build, `verify_build` puis `auto_repair` | Les écarts sont détectés puis corrigés ; conformité revient à 100 % |
| 7 | **Annulation** | `create_checkpoint` sur une zone, build raté dessus, puis `undo` | État initial restauré |
| 8 | **Volume** | `build_blueprint` ou primitives totalisant ~5 000 blocs | S'exécute sans plantage, progression visible, `cancel_build` interrompt proprement |
| 9 | **Copie** | `capture_blueprint` d'une structure existante, `save_blueprint`, puis `build_blueprint` ailleurs | Structure identique à l'originale |

## Mise en place d'un serveur jetable (optionnel)

Pour des tests d'intégration reproductibles, lancer un serveur Minecraft en
conteneur :

```bash
docker run -d --name mc-test -p 25565:25565 \
  -e EULA=TRUE -e VERSION=1.21.4 -e MODE=creative -e ONLINE_MODE=FALSE \
  -e OPS=ClaudeBot \
  itzg/minecraft-server
```

Puis pointer `config.json` sur `127.0.0.1:25565` et donner l'op au bot (`OPS`)
pour autoriser les commandes du backend `command`.
