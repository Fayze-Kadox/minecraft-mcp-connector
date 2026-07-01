# Catalogue d'outils MCP

Chaque outil valide ses entrées (schéma zod), renvoie un JSON
`{ status: "success" | "partial" | "error", message, data? }` et inclut un
message **actionnable**. Tous les outils de construction acceptent un champ
`frame` (`absolute` | `relative` | `local`) et la plupart un `backend`
(`command` | `interact`).

## Connexion / état

| Outil | Entrées | Sortie |
|-------|---------|--------|
| `connect` | — | position après connexion ; message d'erreur lisible sinon |
| `disconnect` | — | confirmation |
| `get_status` | — | état de connexion + position/mode |
| `cancel_build` | — | demande l'annulation coopérative du build en cours |

## 5.1 Perception

| Outil | ID | Entrées | Sortie |
|-------|----|---------|--------|
| `get_position` | PERC-1 | — | x,y,z, exact, yaw, pitch, `facing`, mode, dimension |
| `get_blocks_around` | PERC-2 | `center?`, `radius` (0–24), `frame` | liste compacte des blocs ≠ air |
| `get_block_at` | PERC-3 | `pos`, `frame` | type, displayName, propriétés, boundingBox |
| `scan_region` | PERC-4 | `corner1`, `corner2`, `frame` | grille **RLE** (palette + runs), ordre `yzx` |
| `get_inventory` | PERC-5 | — | item en main + piles (nom, quantité, slot) |
| `get_nearby_entities` | PERC-6 | `radius` (1–64) | entités (nom, type, position, distance) |
| `find_blocks` | PERC-7 | `type`, `radius`, `maxResults` | coordonnées des blocs trouvés |
| `raycast` | PERC-8 | `maxDistance` | bloc visé + face |

## 5.2 Navigation

| Outil | ID | Entrées |
|-------|----|---------|
| `goto` | NAV-1 | `pos`, `tolerance`, `frame` |
| `look_at` | NAV-2 | `pos`, `frame` |
| `follow_player` | NAV-3 | `name`, `distance` |
| `stop` | NAV-4 | — |

## 5.3 Actions bas niveau

| Outil | ID | Entrées |
|-------|----|---------|
| `place_block` | LOW-1 | `pos`, `type`, `frame`, `backend` |
| `break_block` | LOW-2 | `pos`, `frame`, `backend` |
| `use_item` | LOW-3 | `target?`, `frame` |

> Les descriptions de ces outils orientent l'agent vers les primitives haut
> niveau (ex. utiliser `fill_region` plutôt que des `place_block` en boucle).

## 5.4 Primitives haut niveau

| Outil | ID | Entrées clés |
|-------|----|--------------|
| `fill_region` | HIGH-1 | `corner1`, `corner2`, `type`, `mode` (solid/hollow/outline) |
| `draw_line` | HIGH-2 | `p1`, `p2`, `type` |
| `build_wall` | HIGH-3 | `origin`, `direction`, `length`, `height`, `type` |
| `build_floor_ceiling` | HIGH-4 | `corner1`, `corner2`, `type` |
| `build_box` | HIGH-5 | `corner1`, `corner2`, `type`, `floor?`, `ceiling?`, `openings?`, `doorBlock?` |
| `build_sphere` | HIGH-6 | `center`, `radius`, `type`, `hollow?` |
| `build_cylinder` | HIGH-7 | `baseCenter`, `radius`, `height`, `axis?`, `type`, `hollow?` |
| `build_pyramid` | HIGH-8 | `baseCenter`, `baseHalfWidth`, `height`, `type`, `hollow?` |
| `build_stairs` | HIGH-9 | `origin`, `direction`, `length`, `width?`, `fillUnder?`, `type` |
| `clear_region` | HIGH-10 | `corner1`, `corner2` |
| `replace_blocks` | HIGH-11 | `corner1`, `corner2`, `oldType`, `newType` |

Sortie type : `{ label, requested, placed, failures, cancelled }`. Si des blocs
manquent, le statut est `partial` et le message invite à `verify_build` +
`auto_repair`.

## 5.5 Blueprints

| Outil | ID | Entrées |
|-------|----|---------|
| `build_blueprint` | BP-1 | `blueprint`, `origin`, `frame`, `backend` |
| `save_blueprint` | BP-2 | `blueprint` |
| `load_blueprint` | BP-2 | `name` |
| `list_blueprints` | BP-2 | — |
| `capture_blueprint` | BP-3 | `name`, `corner1`, `corner2`, `includeAir?`, `frame` |

## 5.6 Ressources

| Outil | ID | Entrées |
|-------|----|---------|
| `ensure_materials` | RES-1 | `types[]` (créatif) |
| `set_creative_inventory` | RES-2 | `items[] {type, count?}` (créatif) |
| `gather` | RES-3 | `type`, `amount` (survie) |

## 5.7 Vérification / auto-correction

| Outil | ID | Entrées | Sortie |
|-------|----|---------|--------|
| `verify_build` | VERIF-1 | `placements?`, `label?` | rapport : `conformancePct`, `correct`, `discrepancies`, échantillon |
| `auto_repair` | VERIF-2 | `backend` | nb corrigés, écarts restants, conformité finale |

Sans argument, `verify_build` et `auto_repair` portent sur le **dernier build
mémorisé** (toute primitive/blueprint enregistre son état attendu).

## 5.8 Sécurité du chantier

| Outil | ID | Entrées |
|-------|----|---------|
| `create_checkpoint` | SAFE-1 | `corner1`, `corner2`, `id?`, `frame` |
| `undo` | SAFE-2 | `id?`, `backend` |
