# almond-harness-studio

Wire harness drawings from JSON. Design harnesses as `*.harness.json` files (by hand or with a coding agent), preview them live in the browser, and export manufacturer-ready vector PDFs with an auto-derived BOM, wire list, and title block.

- **Local-first**: your harness data stays in your own folders and repos. No accounts, no uploads, no backend.
- **Agent-first**: a JSON schema, a validating CLI with precise errors, and headless PDF export give coding agents a complete author → validate → export loop. A ready-made skill ships in [`skill/`](skill/SKILL.md).
- **Real parts only**: components are sourced from LCSC, Mouser, or Digi-Key by part number. `parts fetch` pulls the distributor record (MPN, description, photo, price, stock) into the file, so drawings show real product photos and a sourced BOM.
- **Manufacturer-ready**: single-sheet drawings (ANSI B, Letter, A3, A4) with pin tables, part photos, branch points, twisted-pair marks, covering callouts, segment lengths, BOM with distributor part numbers, wire list, and notes.

## Quickstart

```bash
npm install && npm run build

# live-preview viewer over a folder of harness files
node packages/cli/dist/index.js dev ./examples

# validate
node packages/cli/dist/index.js validate examples/*.harness.json

# pull distributor data (MPN, photo, price) for every referenced part
node packages/cli/dist/index.js parts fetch examples/branched-battery-pigtail.harness.json

# headless vector PDF export (no browser needed)
node packages/cli/dist/index.js export examples/branched-battery-pigtail.harness.json -o harness.pdf
```

Once published to npm, the same commands run as `npx almond-harness-studio <cmd>`.

## The format in 30 seconds

A harness is a tree of **nodes** (connectors, terminals, splices, breakouts) joined by **segments** (bundle runs with a length and optional covering). **Wires** run pin-to-pin through segments; routing, wire lengths, the BOM, and the wire list are all derived.

Components are always real, orderable parts referenced by distributor part number — LCSC (`lcsc`), Mouser (`mouser`), or Digi-Key (`digikey`). Wire and bulk coverings are the only generic materials.

```json
{
  "meta": { "title": "BATTERY POWER HARNESS", "partNumber": "PN-0001", "rev": "A", "sheet": "ANSI B" },
  "nodes": [
    { "id": "J1", "kind": "connector", "part": { "vendor": "lcsc", "number": "C30170181" },
      "pins": [{ "id": "1", "label": "BAT+" }, { "id": "2", "label": "BAT-" }] },
    { "id": "T1", "kind": "terminal", "style": "ring", "stud": "M5", "part": { "vendor": "lcsc", "number": "C717313" } }
  ],
  "segments": [{ "id": "SEG1", "from": "J1", "to": "T1", "lengthMm": 150, "covering": "pet-braid" }],
  "wires": [{ "id": "W1", "from": "J1.1", "to": "T1", "gauge": "18 AWG", "color": "red" }],
  "notes": ["CRIMP TERMINATIONS PER IPC/WHMA-A-620, NO SOLDER."]
}
```

Supported today: multi-branch harnesses, twisted pairs (`wireGroups`), ring/spade/ferrule/tinned/bare/solder-cup terminations, splices, heatshrink / PET braid / split loom / spiral wrap coverings, striped wire colors, per-node layout overrides.

### Part sourcing

`parts fetch` resolves every `part` reference against the distributor and embeds the record under the file's top-level `parts` object — drawings then render offline with product photos and a sourced BOM. LCSC needs no API key; Mouser and Digi-Key keys are yours:

```bash
node packages/cli/dist/index.js config set mouser.apiKey <key>          # mouser.com/api-hub
node packages/cli/dist/index.js config set digikey.clientId <id>        # developer.digikey.com
node packages/cli/dist/index.js config set digikey.clientSecret <secret>
```

Keys live in `~/.config/almond-harness-studio/config.json` (or `MOUSER_API_KEY`, `DIGIKEY_CLIENT_ID`, `DIGIKEY_CLIENT_SECRET` env vars). The viewer also has an "API keys…" dialog — keys stay in the browser's localStorage and part lookups go through your local dev server.

Full field documentation: [`skill/reference.md`](skill/reference.md). Worked examples: [`examples/`](examples/).

## Using with coding agents

Install the skill so your agent designs harnesses in this format automatically:

- **Cursor**: copy `skill/` to `.cursor/skills/almond-harness-studio/` (project) or `~/.cursor/skills/almond-harness-studio/` (personal)
- **Claude Code**: copy `skill/` to `~/.claude/skills/almond-harness-studio/`
- **Codex / other agents**: point your `AGENTS.md` at `skill/SKILL.md` (see this repo's [`AGENTS.md`](AGENTS.md) for a template)

The agent loop: write JSON → `validate` (schema plus referential checks: pin references, route continuity, tree topology) → `parts fetch` (resolve distributor data) → `export` PDF. Humans watch progress in the live viewer (`dev`), which hot-reloads on every file save.

## Hosting the viewer

The viewer is a static SPA — deploy `packages/app/dist` to any static host (Vercel, Netlify, Cloudflare Pages) and it runs in hosted mode:

- **Open harness file…** (Chrome/Edge) opens a local `.harness.json` via the File System Access API and live-re-renders every time the file is saved — nothing is uploaded, the file is read directly in the browser
- Drag-and-drop works in all browsers (one-shot preview; Chromium browsers get live watching on drop too)
- PDF/SVG download and print work entirely client-side

The local CLI (`dev`) remains the full experience: a whole folder in the sidebar plus push-based reload.

## Repo layout

| Path | What |
|---|---|
| `packages/core` | Types, JSON Schema, validator, tree layout, pure SVG-string renderer (no React — runs in Node and the browser) |
| `packages/app` | React viewer: file sidebar, zoom/pan preview, inline validation errors, PDF/SVG download, print, drag-drop demo mode |
| `packages/cli` | `dev` server (serves viewer + file API + SSE live reload + part-lookup proxy), `validate`, `parts fetch`, `config`, `export` (pdfkit vector PDF) |
| `skill/` | Portable agent skill (SKILL.md + reference + examples) |
| `examples/` | Sample harnesses |

## Development

```bash
npm run dev             # Vite dev server with HMR, API backed by ./examples
npm run typecheck
npm run build
npm run check:examples  # validates all example harnesses
```

Point the dev viewer at a private data folder: `ALMOND_DATA_DIR=/path/to/harnesses npm run dev`.

## License

MIT
