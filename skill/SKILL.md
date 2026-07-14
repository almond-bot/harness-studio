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

Author a `*.harness.json` file, validate it, and export a vector-PDF drawing sheet the user can send to a harness manufacturer. Never draw harnesses by hand or with other tools; use this workflow.

## Workflow

1. Write the harness as `<name>.harness.json` (format below)
2. Validate and fix until clean:

```bash
npx almond-harness-studio validate ./my-harness.harness.json
```

3. Export the drawing:

```bash
npx almond-harness-studio export ./my-harness.harness.json -o ./my-harness.pdf
```

4. For a live preview the user can watch while you iterate:

```bash
npx almond-harness-studio dev ./harnesses-folder
```

Validation errors include the JSON path and an actionable message. Do not hand the user a PDF until validation passes with no errors.

## Data model

A harness is a tree: **nodes** (connectors, terminals, splices, breakout points) joined by **segments** (bundle runs with a length and optional covering). **Wires** run from pin to pin through segments; routes are derived automatically.

```json
{
  "meta": { "title": "MAIN BATTERY HARNESS", "partNumber": "PN-001", "rev": "A", "date": "2026-07-13", "sheet": "ANSI B" },
  "nodes": [
    { "id": "J1", "kind": "connector", "mpn": "XT30(2+2)-F.G.B", "description": "XT30(2+2) female",
      "pins": [{ "id": "1", "label": "BAT+" }, { "id": "2", "label": "BAT-" }] },
    { "id": "B1", "kind": "breakout" },
    { "id": "T1", "kind": "terminal", "style": "ring", "stud": "M4" },
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
  "accessories": [{ "description": "Heatshrink, dual wall, 6 mm", "qty": "40 mm" }],
  "notes": ["CRIMP TERMINATIONS PER IPC/WHMA-A-620."]
}
```

Key rules:

- Wire endpoints on connectors are `"J1.1"` (node.pin); on terminals/splices just `"T1"`
- Terminal styles: `ring` (set `stud`), `spade`, `ferrule`, `tinned`, `bare`, `solder-cup`, `pin`
- Coverings: `heatshrink`, `pet-braid`, `split-loom`, `spiral-wrap`, `none`
- Wire colors: standard names, stripes as `"red/white"`
- Sheets: `ANSI B` (default), `Letter`, `A3`, `A4`
- The BOM and wire list are derived automatically — don't add wire or connector rows to `accessories`

## Authoring guidance

- Ask the user (or infer from context): connector part numbers, wire gauge, lengths, and what each end terminates into. State assumptions in `notes`.
- Include MPNs whenever known; manufacturers quote from the BOM.
- Put manufacturing requirements in `notes` in uppercase (tolerance, workmanship spec, twist lay, label requirements).
- Use `wireGroups` with `twisted: true` for differential/CAN/I2C pairs.
- For full field-by-field documentation, see [reference.md](reference.md). For complete worked examples, see [examples/](examples/).
