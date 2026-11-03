---
name: go-render-3d
description: Use when a 3D model file (STL, OBJ, PLY, STEP, 3MF) needs to become a PNG image — a preview, a thumbnail, a catalog shot, or a visual check of a part — rendered headless with F3D in a fixed, repeatable studio set.
---

# go-render-3d

Renders a 3D model to PNG with [F3D](https://f3d.app), without opening a
window. Every render uses the same set — lights, resolution, camera — so
images of different parts are consistent with each other.

## Use it

```bash
~/.claude/skills/go-render-3d/render-3d <model> [-o out.png] [-b background] [-v view] [-u axis]
```

| Option | Values | Default |
| --- | --- | --- |
| `-o` | output PNG path | next to the model, `<name>.png` |
| `-b` | `white`, `gray` (50%), `black`, `transparent`, `#RRGGBB` | `white` |
| `-v` | `iso` (3/4 from front-right-above, in perspective), `isometric` (same direction, true isometric axonometry: no perspective), `front`, `side`, `top`, `all` | `iso` |
| `-u` | model axis that points up: `+X`, `-X`, `+Y`, `-Y`, `+Z`, `-Z` | `+Z` |

With `-v all` it writes four files, the view name before `.png`:
`<name>-iso.png`, `<name>-front.png`, `<name>-side.png`, `<name>-top.png`.
`isometric` is not part of `all`: ask for it on its own.

Prints the written paths on stdout, one per line; F3D's own output goes to
stderr. Exits non-zero if no PNG was written.

```bash
~/.claude/skills/go-render-3d/render-3d part.stl
~/.claude/skills/go-render-3d/render-3d part.stl -b transparent -v all -o renders/part.png
```

## Orientation

A model file stores the orientation it was printed or drawn in, not the one it
is used in. A part printed upside down renders upside down; an STL exported
from CAD may lie on its side (Y up, centered on the origin). Nothing in the
file says which way is up in use, so it cannot be detected.

Render with the default first and look at the result. If the part is not the
way it is used, pick the axis with `-u` and render again — check the model's
product photos when in doubt. Example: a riser exported Y-up and printed
upside down needs `-u -Y`.

## The set

Fixed in `set.json` next to the script, loaded with `--config`, so F3D's
default config (grid, axes, file name overlay) never applies:
2048×2048, SSAA anti-aliasing, ambient occlusion, F3D default lights. Change
the set there, not in the script. The up axis is not in the set: it depends on
the model, so the script passes it.

## Limits

- **Requires `f3d` in PATH** (`brew install f3d`, tested with 4.0.0).
- **3MF files saved by Bambu Studio / Makerworld do not load**: the geometry
  lives in `3D/Objects/*.model`, which F3D's 3MF reader does not follow
  ("aiScene::mNumMeshes is 0"). Use the STL export instead.
- The part is centered on the center of its bounding box, so an asymmetric
  part can look slightly off-center in the 3/4 view. It is always framed whole.
- F3D has no shadow option.
