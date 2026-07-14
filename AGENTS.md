# AGENTS.md

## Wire harness drawings

This project uses almond-harness-studio to design wire harnesses as JSON and export manufacturer-ready PDF drawings.

When asked to design, draw, document, or quote a wire harness, cable assembly, or pigtail, follow the instructions in [skill/SKILL.md](skill/SKILL.md). In short:

1. Author `<name>.harness.json` (schema guide: [skill/reference.md](skill/reference.md), examples: [skill/examples/](skill/examples/))
2. `npx almond-harness-studio validate <file>` and fix all errors
3. `npx almond-harness-studio export <file> -o <file>.pdf`

## Repo conventions

- TypeScript, double quotes, npm workspaces (`packages/core`, `packages/app`, `packages/cli`)
- `npm run build` builds everything; `npm run dev` starts the viewer against `examples/`
- `npm run check:examples` must pass; run it after changing the schema, validator, or examples
