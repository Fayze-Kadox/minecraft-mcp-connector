# Spécification du format Blueprint

Un *blueprint* est un objet JSON décrivant une structure complète. Le connecteur le compile en une liste de poses absolues, ordonnée du bas vers le haut, et l'exécute en un seul appel via `build_blueprint`.

Deux variantes, **non exclusives** (on peut combiner les deux ; les primitives sont appliquées après les couches, et la dernière pose sur une même case l'emporte).

## Champs communs

| Champ | Type | Obligatoire | Description |
|-------|------|-------------|-------------|
| `name` | string | oui | Nom du blueprint (`[A-Za-z0-9_-]` pour la sauvegarde). |
| `origin` | `"absolute"` \| `"relative"` \| `"local"` | non | Repère d'ancrage de l'origine passée à `build_blueprint`. Défaut : le `frame` de l'appel. |
| `palette` | object | pour `layers` | Table symbole → nom de bloc. |
| `layers` | array | variante A | Grille par couches Y. |
| `primitives` | array | variante B | Liste de primitives haut niveau composées. |
| `meta` | object | non | Métadonnées libres (dimensions, auteur…). |

L'**origine** correspond à la cellule `(x=0, y=0, z=0)` du blueprint (coin de plus petites coordonnées).

## Variante A — grille par couches (`layers`)

Chaque couche a un décalage `y` et une liste de `rows`. Convention :

- `rows[0]` correspond à **z = 0**, `rows[1]` à `z = 1`, etc. (z croît vers le sud).
- Le caractère d'indice `i` d'une ligne correspond à **x = i** (x croît vers l'est).
- Les symboles `" "`, `"."`, `"_"`, `"-"` représentent de l'**air** (non posé).
- Tout autre symbole doit exister dans `palette`, sinon erreur explicite.

```json
{
  "name": "petite_maison",
  "origin": "relative",
  "palette": { "#": "oak_planks", "G": "glass", ".": "air", "D": "oak_door" },
  "layers": [
    { "y": 0, "rows": ["#####", "#...#", "#...#", "#...#", "#####"] },
    { "y": 1, "rows": ["##D##", "#...#", "G...G", "#...#", "#####"] },
    { "y": 2, "rows": ["#####", "#...#", "#...#", "#...#", "#####"] },
    { "y": 3, "rows": ["#####", "#####", "#####", "#####", "#####"] }
  ]
}
```

## Variante B — primitives composées (`primitives`)

Une liste d'opérations dont les coordonnées sont **relatives à l'origine** du blueprint. Pratique pour les grandes formes paramétriques (tours, dômes) sans dessiner chaque couche.

```json
{
  "name": "tour_ronde",
  "origin": "absolute",
  "primitives": [
    { "op": "build_cylinder", "args": { "baseCenter": {"x":0,"y":0,"z":0}, "radius": 5, "height": 12, "type": "stone_bricks", "hollow": true } },
    { "op": "build_cylinder", "args": { "baseCenter": {"x":0,"y":12,"z":0}, "radius": 6, "height": 1, "type": "stone_brick_slab" } },
    { "op": "build_cylinder", "args": { "baseCenter": {"x":0,"y":13,"z":0}, "radius": 5, "height": 4, "type": "stone_bricks", "hollow": true } }
  ]
}
```

### Opérations supportées et leurs `args`

| `op` | `args` (coordonnées relatives à l'origine) |
|------|---------------------------------------------|
| `fill_region` | `corner1`, `corner2`, `type`, `mode` (`solid`\|`hollow`\|`outline`) |
| `draw_line` | `p1`, `p2`, `type` |
| `build_wall` | `origin` (ou `x/y/z`), `direction`, `length`, `height`, `type` |
| `build_floor_ceiling` | `corner1`, `corner2`, `type` |
| `build_box` | `corner1`, `corner2`, `type`, `floor?`, `ceiling?`, `openings?` |
| `build_sphere` | `center`, `radius`, `type`, `hollow?` |
| `build_cylinder` | `baseCenter`, `radius`, `height`, `axis?` (`x`\|`y`\|`z`), `type`, `hollow?` |
| `build_pyramid` | `baseCenter`, `baseHalfWidth`, `height`, `type`, `hollow?` |
| `build_stairs` | `origin`, `direction`, `length`, `width?`, `fillUnder?`, `type` |

## Ouvertures (`openings`) pour `build_box`

Une ouverture perce une fente dans un mur :

```json
{ "face": "north", "offset": 2, "width": 1, "height": 2, "sill": 0 }
```

- `face` : mur concerné (`north`/`south`/`east`/`west`).
- `offset` : décalage le long du mur depuis le coin de plus petites coordonnées.
- `width` / `height` : taille de l'ouverture.
- `sill` : hauteur de départ depuis le sol de la boîte (0 = porte ; 1 = fenêtre).

## Cycle de vie

1. **Construire** : `build_blueprint` avec un objet `blueprint` + `origin`.
2. **Vérifier** : `verify_build` renvoie le rapport de conformité (% + écarts).
3. **Corriger** : `auto_repair` re-pose les blocs manquants/incorrects.
4. **Sauvegarder** : `save_blueprint` pour réutiliser (`load_blueprint` / `list_blueprints`).
5. **Copier l'existant** : `capture_blueprint` scanne une zone et produit un blueprint `layers` que l'on peut reconstruire ailleurs.

## Bonnes pratiques pour l'agent

- Préférer une **origine `local`** pour construire « devant soi » sans calculer les coordonnées absolues.
- Pour les très grosses structures, composer des **primitives** plutôt que d'énumérer chaque bloc en `layers`.
- Toujours enchaîner `build_blueprint` → `verify_build`. Si conformité < 100 %, lancer `auto_repair`.
- Avant une modification risquée d'une zone existante : `create_checkpoint`, puis `undo` si besoin.
