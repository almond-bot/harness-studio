---
name: almond-harness-studio
description: >-
  Design wire harnesses and cable assemblies as JSON and produce
  manufacturer-ready drawings (BOM, wire list, title block) as PDF. Use when
  the user asks to design, draw, document, or quote a wire harness, cable
  assembly, pigtail, or custom cable — or mentions connectors, crimping,
  splices, twisted pairs, ring terminals, or harness drawings.
---

# almond-harness-studio

Author a `*.harness.json` file, validate it, fetch its parts from the distributor, and export a vector-PDF drawing sheet the user can send to a harness manufacturer. Never draw harnesses by hand or with other tools; use this workflow.

Components are always real, orderable parts sourced from **LCSC**, **Mouser**, or **Digi-Key** — there are no free-form components (wire and bulk coverings are the only exceptions). Every connector, terminal, and accessory carries a `part` reference like `{ "vendor": "lcsc", "number": "C30170181" }`.

## Workflow

1. Write the harness as `<name>.harness.json` (format below). Look up real distributor part numbers for every connector/terminal/accessory — search the vendor sites if the user didn't give you one, and confirm your picks with the user when uncertain.
2. Validate and fix until clean:

```bash
npx almond-harness-studio validate ./my-harness.harness.json
```

3. Fetch distributor data (description, MPN, photo, price, stock) into the file:

```bash
npx almond-harness-studio parts fetch ./my-harness.harness.json
```

LCSC needs no API key. Mouser and Digi-Key keys come from the user:

```bash
npx almond-harness-studio config set mouser.apiKey <key>
npx almond-harness-studio config set digikey.clientId <id>
npx almond-harness-studio config set digikey.clientSecret <secret>
```

(or env vars `MOUSER_API_KEY`, `DIGIKEY_CLIENT_ID`, `DIGIKEY_CLIENT_SECRET`)

4. Export the drawing — resolved parts render with product photos and a sourced BOM:

```bash
npx almond-harness-studio export ./my-harness.harness.json -o ./my-harness.pdf
```

5. If the manufacturer wants spreadsheets, export the wiring table and BOM as CSV:

```bash
npx almond-harness-studio tables ./my-harness.harness.json
```

6. For a live preview the user can watch while you iterate:

```bash
npx almond-harness-studio dev ./harnesses-folder
```

Validation errors include the JSON path and an actionable message. Unresolved parts are reported as warnings until `parts fetch` runs. Do not hand the user a PDF until validation passes with no errors and all parts are fetched.

## Data model

A harness is a tree: **nodes** (connectors, terminals, splices, breakout points, inline diodes/resistors) joined by **segments** (bundle runs with a length and optional covering). **Wires** run from pin to pin through segments; routes are derived automatically.

```json
{
  "meta": { "title": "MAIN BATTERY HARNESS", "partNumber": "PN-001", "rev": "A", "date": "2026-07-13", "sheet": "ANSI B" },
  "nodes": [
    { "id": "J1", "kind": "connector", "part": { "vendor": "lcsc", "number": "C30170181" },
      "pins": [{ "id": "1", "label": "BAT+" }, { "id": "2", "label": "BAT-" }] },
    { "id": "B1", "kind": "breakout" },
    { "id": "T1", "kind": "terminal", "style": "ring", "stud": "M5", "part": { "vendor": "lcsc", "number": "C717313" } },
    { "id": "SP1", "kind": "splice", "method": "crimp" }
  ],
  "segments": [
    { "id": "SEG1", "from": "J1", "to": "B1", "lengthMm": 100, "covering": "pet-braid" },
    { "id": "SEG2", "from": "B1", "to": "T1", "lengthMm": 50 }
  ],
  "wires": [
    { "id": "W1", "from": "J1.1", "to": "T1", "gauge": "16 AWG", "color": "red" }
  ],
  "wireGroups": [{ "id": "TW1", "wires": ["W3", "W4"], "twisted": true }],
  "accessories": [{ "part": { "vendor": "lcsc", "number": "C2837172" }, "qty": "40 mm" }],
  "notes": ["CRIMP TERMINATIONS PER IPC/WHMA-A-620."]
}
```

Key rules:

- Every connector requires a `part` (`vendor` + `number`). Real terminals require one too; `tinned`/`bare` are wire preparations and take none. Connectors also take optional `contacts` (crimp contact part, BOM qty = wired cavities) and `hardware` (locks, boots, backshells).
- Part vendors: `lcsc` (part # like `C30170181`), `mouser` (Mouser # or MPN), `digikey` (Digi-Key # or MPN)
- Wire endpoints on connectors are `"J1.1"` (node.pin); on terminals/splices/diodes/resistors just `"T1"`
- Terminal styles: `ring` (set `stud`), `spade`, `ferrule`, `quick-connect-male`, `quick-connect-female`, `tinned`, `bare`, `solder-cup`, `pin`
- Inline `diode`/`resistor` nodes take a `part`, exactly 2 wires, and a segment into the tree; diodes take `cathodeTowards` (node id the band faces)
- A wire between two pins of the same connector is a jumper (loopback) — zero length, drawn as an arc
- `wireGroups` with `cable: true` model multicore cables (optional `shield: "foil" | "braid"`, optional sourced cable `part`); with `twisted: true`, twisted pairs
- Coverings: `heatshrink`, `pet-braid`, `split-loom`, `spiral-wrap`, `none`
- Wire colors: standard names, stripes as `"red/white"`
- Sheets: `ANSI B` (default), `Letter`, `A3`, `A4`
- The BOM and wire list are derived automatically — don't add wire or connector rows to `accessories`
- Never hand-write the top-level `parts` object — `parts fetch` maintains it

## Authoring guidance

- Ask the user (or infer from context): connector part numbers, wire gauge, lengths, and what each end terminates into. State assumptions in `notes`.
- Prefer LCSC part numbers when the user has no vendor preference — lookups need no API key.
- Put manufacturing requirements in `notes` in uppercase (tolerance, workmanship spec, twist lay, label requirements).
- Use `wireGroups` with `twisted: true` for differential/CAN/I2C pairs.
- For full field-by-field documentation, see [reference.md](reference.md). For complete worked examples, see [examples/](examples/).
