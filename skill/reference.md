# Harness JSON reference

Complete field documentation for `*.harness.json` files. The machine-readable schema lives at `packages/core/src/schema.json` in the almond-harness-studio repo.

## Top level

| Field | Required | Description |
|---|---|---|
| `meta` | yes | Title block fields |
| `nodes` | yes | Connectors, terminals, splices, breakouts, inline diodes/resistors |
| `segments` | yes | Bundle runs between nodes (the harness tree) |
| `wires` | yes | Conductors, routed through segments |
| `wireGroups` | no | Twisted pairs and multicore cables |
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
- `contacts`: crimp contact part; BOM quantity = number of wired cavities
- `hardware`: array of parts for locks, boots, backshells, dust covers (one BOM line each)
- `face`: renders an "ASSEMBLY DETAIL" card (product photo + face view of the real pin pattern, each cavity filled in its wire's color) — this is how an operator orients an asymmetric connector in hand and sees which way the wires bend. Author pin positions from the part's datasheet drawing:

```json
{ "view": "wire-side", "wireBend": "down", "note": "PCB PROVIDED BY CUSTOMER",
  "pins": [
    { "pin": "1", "x": 0, "y": 0, "size": 1.7 },
    { "pin": "2", "x": 10, "y": 0, "size": 1.7 },
    { "pin": "S1", "x": 15.5, "y": 3.2, "size": 0.9 },
    { "pin": "S2", "x": 15.5, "y": -3.2, "size": 0.9 }
  ] }
```

  - `pins` (required): one entry per drawn cavity; `pin` references the connector's pin ids, `x`/`y` are relative positions in any consistent unit (+y is up, the view auto-scales), `size` scales the marker (e.g. 1.7 for power pins, 0.9 for signal pins)
  - `wireBend`: direction the wires bend after leaving the connector, in this view's frame — `up`, `down`, `left`, `right`. Drawn as a bold arrow and stated in the caption.
  - `view`: `wire-side` (default — the face the operator solders/crimps at) or `mating-side`. Mind the mirror flip: the same pattern viewed from the wire side is left-right mirrored vs the mating side.
  - `note`: caption under the detail. State tolerances and covering extent in top-level `notes`.

### terminal

- `style` (required): `ring`, `spade`, `ferrule`, `quick-connect-male`, `quick-connect-female`, `tinned`, `bare`, `solder-cup`, `pin`
- `stud`: for ring/spade, e.g. `"M4"` or `"#10"`
- `part`: required for real parts; omitted only for wire preparations (`tinned`, `bare`)

### splice

- `method`: `crimp`, `solder`, `ultrasonic`
- `part`: optional sourced splice hardware (butt splice, crimp band)
- Wires ending at a splice reference it without a pin: `"to": "SP1"`

### breakout

No electrical function — the point where a bundle branches. Give it an id like `"B1"`.

### diode / resistor

Inline two-lead component spliced into the harness (flyback diodes, pull resistors).

- `part` (required): sourced component
- Must have exactly 2 wires attached, referenced without a pin (`"to": "D1"`)
- Needs a segment connecting it into the harness tree, like any node
- `cathodeTowards` (diode only): node id the cathode band faces on the drawing
- Typical flyback pattern: splices SP1/SP2 on the two lines, segment SP2→D1, wires SP1→D1 and D1→SP2

## segments

Each segment is one physical bundle run: `{ "id": "SEG1", "from": "J1", "to": "B1", "lengthMm": 100, "covering": "pet-braid" }`.

- The segment graph must be a connected tree (no cycles, no islands)
- `lengthMm`: run length; wire lengths and covering quantities are derived from it
- `covering`: `heatshrink`, `pet-braid`, `split-loom`, `spiral-wrap`, `none`

## wires

`{ "id": "W1", "from": "J1.1", "to": "T1", "gauge": "18 AWG", "color": "red", "label": "W1", "route": ["SEG1", "SEG2"], "notes": "..." }`

- Endpoints: `"J1.1"` = pin 1 of connector J1; pinless nodes (terminal/splice/breakout/diode/resistor) are referenced by node id alone
- `route` is optional — the path through the tree is derived automatically; only set it when you want to be explicit
- `gauge` and `color` are optional but warn when missing; always set them for manufacturing drawings
- `color`: `black, brown, red, orange, yellow, green, blue, violet, gray, white, pink, tan`; stripe with `"base/stripe"`, e.g. `"white/blue"`
- **Jumper (loopback)**: a wire between two pins of the same connector, e.g. `"from": "J2.2", "to": "J2.3"`. Renders as an arc at the connector face, counts as zero length, and is flagged `JUMPER` in the wire list.

## wireGroups

Twisted pairs and multicore cables.

`{ "id": "TW1", "wires": ["W3", "W4"], "twisted": true, "label": "TW1" }`

Twisted groups render a twist symbol on the shared segment and add `TWISTED (TW1)` to the wire list rows.

`{ "id": "CB1", "wires": ["W7", "W8"], "cable": true, "twisted": true, "shield": "foil", "part": { "vendor": "lcsc", "number": "C…" } }`

Cable groups (`cable: true`) treat the member wires as cores of one multicore cable:

- A sheath outline is drawn along every segment all cores share; `shield: "foil" | "braid"` adds a shield outline and callout
- The BOM lists the cable (length = longest core) instead of the individual core wires; `part` sources it (optional — cable stock, like wire, may stay generic)
- State shield termination in `notes` (e.g. "DO NOT TERMINATE SHIELD AT J2 END")

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
npx almond-harness-studio tables <file> [-o dir]    # wiring table + BOM as CSV for manufacturing
npx almond-harness-studio dev [dir] [-p port]       # live-preview viewer (default command)
```

API keys: LCSC lookups need no key. Mouser needs a Search API key (mouser.com/api-hub). Digi-Key needs a Product Information v4 app's client ID/secret (developer.digikey.com). Keys load from `~/.config/almond-harness-studio/config.json` or env vars `MOUSER_API_KEY`, `DIGIKEY_CLIENT_ID`, `DIGIKEY_CLIENT_SECRET`.
