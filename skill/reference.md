# Harness JSON reference

Complete field documentation for `*.harness.json` files. The machine-readable schema lives at `packages/core/src/schema.json` in the almond-harness-studio repo.

## Top level

| Field | Required | Description |
|---|---|---|
| `meta` | yes | Title block fields |
| `nodes` | yes | Connectors, terminals, splices, breakouts |
| `segments` | yes | Bundle runs between nodes (the harness tree) |
| `wires` | yes | Conductors, routed through segments |
| `wireGroups` | no | Twisted pairs/triples |
| `accessories` | no | Extra BOM lines (heatshrink pieces, labels, ties) |
| `notes` | no | Numbered manufacturing notes on the sheet |
| `layout` | no | `{ "root": "J1" }` — node placed at the drawing's left |

## meta

| Field | Notes |
|---|---|
| `title` | Required. Uppercase looks best in the title block |
| `partNumber`, `rev`, `date`, `company`, `drawnBy` | Optional title block fields |
| `sheet` | `"ANSI B"` (default, 17x11), `"Letter"`, `"A3"`, `"A4"` |

## nodes

All nodes: `id` (unique, `[A-Za-z0-9_-]+`), `kind`, optional `position` `{x, y}` to override auto-layout (rarely needed).

### connector

- `pins` (required): array of `{ "id": "1", "label": "BAT+" }`. Pin ids are strings — `"S1"`, `"A"` are fine.
- `mpn`: manufacturer part number — include whenever known, it feeds the BOM
- `description`: e.g. `"XT30(2+2) female, power + signal"`

### terminal

- `style` (required): `ring`, `spade`, `ferrule`, `tinned`, `bare`, `solder-cup`, `pin`
- `stud`: for ring/spade, e.g. `"M4"` or `"#10"`
- `mpn`, `description`: optional BOM enrichment

### splice

- `method`: `crimp`, `solder`, `ultrasonic`
- Wires ending at a splice reference it without a pin: `"to": "SP1"`

### breakout

No electrical function — the point where a bundle branches. Give it an id like `"B1"`.

## segments

Each segment is one physical bundle run: `{ "id": "SEG1", "from": "J1", "to": "B1", "lengthMm": 100, "covering": "pet-braid" }`.

- The segment graph must be a connected tree (no cycles, no islands)
- `lengthMm`: run length; wire lengths and covering quantities are derived from it
- `covering`: `heatshrink`, `pet-braid`, `split-loom`, `spiral-wrap`, `none`

## wires

`{ "id": "W1", "from": "J1.1", "to": "T1", "gauge": "18 AWG", "color": "red", "label": "W1", "route": ["SEG1", "SEG2"], "notes": "..." }`

- Endpoints: `"J1.1"` = pin 1 of connector J1; pinless nodes (terminal/splice/breakout) are referenced by node id alone
- `route` is optional — the path through the tree is derived automatically; only set it when you want to be explicit
- `gauge` and `color` are optional but warn when missing; always set them for manufacturing drawings
- `color`: `black, brown, red, orange, yellow, green, blue, violet, gray, white, pink, tan`; stripe with `"base/stripe"`, e.g. `"white/blue"`

## wireGroups

`{ "id": "TW1", "wires": ["W3", "W4"], "twisted": true, "label": "TW1" }`

Twisted groups render a twist symbol on the shared segment and add `TWISTED (TW1)` to the wire list rows.

## accessories

Extra BOM rows: `{ "mpn": "...", "description": "Heatshrink, dual wall, 6 mm", "qty": "40 mm" }`. `qty` may be a number or string. Do not duplicate connectors/wire/coverings here — those BOM rows are derived.

## Derived outputs (do not author)

- **BOM**: connectors and terminals grouped by MPN, wire totals by gauge+color, covering totals by type, then accessories
- **Wire list**: one row per wire with from/to, gauge, color code, computed length (sum of routed segment lengths), twist notes
- **Layout**: tree drawn left-to-right from the root; use `layout.root` to change which connector is on the left

## CLI

```bash
npx almond-harness-studio validate <files...>   # schema + referential checks; exit 1 on error
npx almond-harness-studio export <file> [-o out.pdf] [--svg]
npx almond-harness-studio dev [dir] [-p port]   # live-preview viewer (default command)
```
