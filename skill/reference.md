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
| `accessories` | no | Extra sourced BOM lines (heatshrink pieces, labels, ties) |
| `notes` | no | Numbered manufacturing notes on the sheet |
| `layout` | no | `{ "root": "J1" }` — node placed at the drawing's left |
| `parts` | no | Resolved distributor data, written by `parts fetch` — never hand-edit |

## Sourced parts

Components are always real, orderable parts. Everywhere a `part` appears it is:

```json
{ "vendor": "lcsc", "number": "C30170181" }
```

- `vendor`: `lcsc`, `mouser`, or `digikey`
- `number`: LCSC part # (`C…`), Mouser part # or MPN, Digi-Key part # or MPN

`parts fetch` resolves each reference against the distributor API and embeds the result (MPN, manufacturer, description, datasheet, product photo, unit price, stock) under the top-level `parts` object, keyed `"vendor:number"`. The renderer then shows the product photo next to the node and fills the BOM's PART NUMBER/DESCRIPTION/SOURCE columns from distributor data. Files with embedded parts render fully offline.

## meta

| Field | Notes |
|---|---|
| `title` | Required. Uppercase looks best in the title block |
| `partNumber`, `rev`, `date`, `company`, `drawnBy` | Optional title block fields |
| `sheet` | `"ANSI B"` (default, 17x11), `"Letter"`, `"A3"`, `"A4"` |

## nodes

All nodes: `id` (unique, `[A-Za-z0-9_-]+`), `kind`, optional `position` `{x, y}` to override auto-layout (rarely needed).

### connector

- `part` (required): sourced component, e.g. `{ "vendor": "lcsc", "number": "C30170181" }`
- `pins` (required): array of `{ "id": "1", "label": "BAT+" }`. Pin ids are strings — `"S1"`, `"A"` are fine.

### terminal

- `style` (required): `ring`, `spade`, `ferrule`, `tinned`, `bare`, `solder-cup`, `pin`
- `stud`: for ring/spade, e.g. `"M4"` or `"#10"`
- `part`: required for real parts (`ring`, `spade`, `ferrule`, `solder-cup`, `pin`); omitted for wire preparations (`tinned`, `bare`)

### splice

- `method`: `crimp`, `solder`, `ultrasonic`
- `part`: optional sourced splice hardware (butt splice, crimp band)
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

Extra sourced BOM rows: `{ "part": { "vendor": "lcsc", "number": "C2837172" }, "qty": "40 mm", "notes": "over branch B1-J2" }`. `qty` may be a number or string. Do not duplicate connectors/wire/coverings here — those BOM rows are derived.

## Derived outputs (do not author)

- **BOM**: sourced parts grouped by vendor part number (with SOURCE column), wire totals by gauge+color, covering totals by type, then accessories
- **Wire list**: one row per wire with from/to, gauge, color code, computed length (sum of routed segment lengths), twist notes
- **Layout**: tree drawn left-to-right from the root; use `layout.root` to change which connector is on the left
- **`parts`**: distributor data embedded by `parts fetch`; product photos render on the drawing

## CLI

```bash
npx almond-harness-studio validate <files...>       # schema + referential checks; exit 1 on error
npx almond-harness-studio parts fetch <files...>    # resolve part refs against LCSC/Mouser/Digi-Key, embed in file
npx almond-harness-studio config set <key> <value>  # mouser.apiKey | digikey.clientId | digikey.clientSecret
npx almond-harness-studio config list               # show configured keys (masked)
npx almond-harness-studio export <file> [-o out.pdf] [--svg]
npx almond-harness-studio dev [dir] [-p port]       # live-preview viewer (default command)
```

API keys: LCSC lookups need no key. Mouser needs a Search API key (mouser.com/api-hub). Digi-Key needs a Product Information v4 app's client ID/secret (developer.digikey.com). Keys load from `~/.config/almond-harness-studio/config.json` or env vars `MOUSER_API_KEY`, `DIGIKEY_CLIENT_ID`, `DIGIKEY_CLIENT_SECRET`.
