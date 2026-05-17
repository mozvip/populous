# Populous Clone — Rules & Mechanics

A simplified Populous-style god game. You are the deity of the **blue tribe**; an
AI opponent commands the **red tribe**. Reshape the land to help your followers
spread and wipe out the rival tribe.

## Objective

Eliminate the enemy: a team loses when it has **zero walkers and zero
houses**. The other team wins.

## Controls

| Input              | Action                                              |
|--------------------|-----------------------------------------------------|
| **Left click**     | Raise the targeted vertex by 1                      |
| **Right click**    | Lower the targeted vertex by 1                      |
| **Right drag**     | Pan the camera (target is clamped to the island)    |
| **Middle drag**    | Orbit the camera                                    |
| **Scroll**         | Zoom                                                |
| **R**              | Restart with a fresh island                         |

A click is distinguished from a drag by movement: if the mouse moves less than
4 px between mousedown and mouseup, it counts as a click. Otherwise the press
is interpreted as a camera gesture.

The yellow wireframe octahedron is the **vertex cursor**. It snaps to the grid
corner nearest your mouse, showing exactly which point you will raise or lower.

## The world

- The map is a **48 × 48 grid of cells**, surrounded by water on all sides.
- The heightfield lives on the **49 × 49 grid of vertices** (corners), not the
  cells. Each vertex stores an integer height in `[0, 8]`.
- A cell is a quad bounded by 4 vertices and is rendered as 2 triangles. Its
  visual color comes from the average corner height:
  - 0       → water (rendered, then covered by the water plane)
  - ≤ 1.2   → sand
  - ≤ 3     → grass
  - ≤ 5     → hill (brown)
  - ≤ 7     → rock
  - else    → snow
- World units: each cell is 1 unit wide; each integer height level is 0.5
  units tall (`STEP`).

## Terrain shaping

Every left/right click acts on **one vertex**, never a whole cell:

1. The vertex's height changes by ±1 (clamped to `[0, MAX_H]`).
2. A breadth-first **smoothing pass** then walks the 8-neighborhood of the
   vertex grid, enforcing the rule that no two adjacent vertices (orthogonal
   or diagonal) ever differ by more than 1. Raising a vertex pulls its
   neighbors up to satisfy the rule; lowering does the opposite. The cascade
   continues until stable.
3. The whole mesh is rebuilt. The render diagonal of each cell is chosen so
   the cut runs between the two closer-in-height corners — saddle cells stay
   visually tidy.

The same `|Δh| ≤ 1` invariant is maintained at world generation time, so the
island is born obeying it.

Each shape action costs **3 mana**. If your blue team is short, the action is
refused and a "Not enough mana" toast flashes.

## Walkers

Each tribe is a list of `Walker` capsules.

- **Hit points**: 100 per walker.
- **Speed**: 1.6–2.0 cells/second (randomized per spawn).
- **Height**: walker Y is the **bilinear interpolation** of the 4 corners of
  the cell they stand on, so they ride slopes smoothly.

### Walker AI (priority order)

Re-evaluated whenever a walker has no target, or every ~1.5 s.

1. **Build here.** If the walker is already standing on a buildable patch
   (see *Settling* below) → set target `build`.
2. **Build nearby.** Otherwise spiral outward from the walker through rings
   `r = 1..9` looking for the nearest buildable patch they're allowed to
   claim. Break on first hit → set target `move` to the patch center.
3. **Fight.** No build site within range? Find the nearest enemy walker
   within ~14 cells → set target `attack`.
4. **Wander.** Pick a random point 2–5 cells away in a random direction.

### Settling — what counts as buildable

All of the following must be true:

- The 2 × 2 cell footprint (= **3 × 3 vertices**) starting at the candidate
  cell is **perfectly flat at the same integer height ≥ 1**. A single
  off-by-one vertex disqualifies the patch.
- No existing house overlaps that cell (overlap test is *NW-corner-in-house*).
- The cell's ownership is either neutral (`0`) or already this team's.
- The walker can physically reach the patch — see *Movement* below.

On arrival, the patch is re-checked. If still valid, a house is placed.

> This 3 × 3-vertex flatness check is strict on purpose. Land that *looks*
> flat in the rendered island usually has small bumps; almost any natural
> patch will fail. The intended loop is that **you, the god, flatten land
> to give your tribe somewhere to settle.**

### Movement

Walkers don't pathfind. They step in a straight line toward their target.
Every step, the destination cell is checked for **walkability**:

- All 4 corner heights ≥ 1 (above sea level), AND
- `max(corner) − min(corner) ≤ 1` (slope is gentle).

If the next cell fails the test, the walker drops the target, waits 0.4 s,
and re-picks. A walker can therefore get stuck oscillating in front of a
cliff — flatten the obstacle if you want them to push through.

### Combat

Any two enemy walkers within `0.59` cells of each other lose 35 HP/sec each.
First to 0 dies. Both can die on the same tick.

## Houses (settlements)

- **Footprint**: 2 × 2 cells, anchored at the cell the founding walker
  reached. The 9 vertices of that footprint are the *load-bearing* corners.
- **Visual**: box walls + pyramid roof, tinted by team.
- **Territory tint**: when a house is placed, ownership of the 4 × 4 cells
  centered on it is claimed for the team. The terrain mesh shades these
  cells with a slight team-color tint.
- **Footprint check**: every frame the house re-verifies that all 9
  vertices are still at the height they were built on. Touch *any* of them
  with a raise or lower (yours or the AI's) and the house **collapses
  immediately** — that's the core Populous mechanic.
- **Walker production**: each standing house spawns a new walker every
  3.5–5.5 s, up to a tribe-wide cap of `houses × 5`.

> The cap is why expansion is bootstrap-limited: with 1 starting house you
> are capped at 5 walkers until somebody settles a second house. The
> chicken-and-egg is intentional — you the god are expected to unblock it.

## Mana

Each team has its own pool, starting at 20 and rising every tick:

```
mana += dt × (1 + 0.15 × population)
```

…capped at 200. Population growth therefore feeds itself: more walkers →
faster mana regen → more shaping actions.

The only thing mana is spent on (currently) is terrain shaping: **3 mana per
vertex raise or lower**.

## The AI opponent

Every 1.6–2.8 s the red god takes a turn, if it has ≥ 6 mana.

- **60 %** of turns: pick a random red walker, scan a 7 × 7 vertex window
  around them, and shape the vertex whose height is *furthest* from the
  walker's stand height — pulling its world toward flatness. Costs 4 mana.
- **40 %** of turns: find the nearest blue walker, raise the vertex halfway
  between them. This often walls off blue movement or hits a blue house's
  footprint. Costs 5 mana.

There is no fog of war: both gods see the whole island.

## Edge behaviour

- Cells at the map border have a "virtual" out-of-grid neighbor. Walls are
  drawn down to `y = 0` so the island doesn't visually float.
- Camera target is clamped to `[0, GRID]` on X and Z so panning can't lose
  the island.
- Restart (`R`) tears down all walkers, houses, and terrain geometry and
  rebuilds a fresh game using the same noise seed.

## Reference: file map

| File          | Role                                                  |
|---------------|-------------------------------------------------------|
| `index.html`  | DOM scaffolding, HUD, three.js importmap              |
| `style.css`   | HUD panels and centered win/lose message              |
| `main.js`     | Whole game: terrain, walkers, houses, AI, input, loop |
