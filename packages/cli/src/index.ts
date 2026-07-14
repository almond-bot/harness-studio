#!/usr/bin/env node
import { promises as fs } from "node:fs";
import { createWriteStream } from "node:fs";
import http from "node:http";
import path from "node:path";
import { createRequire } from "node:module";
import { Command } from "commander";
import {
  validateHarness,
  renderHarnessSvg,
  collectPartRefs,
  formatSource,
  partKey,
  buildBom,
  buildWireList,
  type Harness,
  type PartsCache,
} from "@almond-bot/harness-studio-core";
import { createApiHandler } from "./middleware.js";
import { CONFIG_PATH, loadConfig, resolvePart, saveConfigValue } from "./vendors.js";

const require = createRequire(import.meta.url);
const { version: cliVersion } = require("../package.json") as { version: string };

const program = new Command();
program
  .name("almond-harness-studio")
  .description("Wire harness drawings from JSON: live preview, validation, and PDF export")
  .version(cliVersion);

function loadAndValidate(file: string, raw: string): { harness?: Harness; ok: boolean } {
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch (err) {
    console.error(`✗ ${file}: invalid JSON — ${(err as Error).message}`);
    return { ok: false };
  }
  const result = validateHarness(data);
  for (const warning of result.warnings) {
    console.warn(`  ⚠ ${file}${warning.path}: ${warning.message}`);
  }
  if (!result.valid) {
    console.error(`✗ ${file}: ${result.errors.length} error(s)`);
    for (const error of result.errors) {
      console.error(`  ✗ ${error.path}: ${error.message}`);
    }
    return { ok: false };
  }
  return { harness: result.harness, ok: true };
}

program
  .command("validate")
  .description("Validate harness JSON files (schema + referential checks)")
  .argument("<files...>", "harness JSON files")
  .action(async (files: string[]) => {
    let failed = 0;
    for (const file of files) {
      let raw: string;
      try {
        raw = await fs.readFile(file, "utf8");
      } catch {
        console.error(`✗ ${file}: cannot read file`);
        failed++;
        continue;
      }
      const { ok } = loadAndValidate(file, raw);
      if (ok) console.log(`✓ ${file}: valid`);
      else failed++;
    }
    if (failed > 0) process.exit(1);
  });

program
  .command("export")
  .description("Export a harness drawing to PDF or SVG (headless, no browser)")
  .argument("<file>", "harness JSON file")
  .option("-o, --output <path>", "output file (default: input name with .pdf/.svg)")
  .option("--svg", "export SVG instead of PDF")
  .action(async (file: string, opts: { output?: string; svg?: boolean }) => {
    const raw = await fs.readFile(file, "utf8");
    const { harness, ok } = loadAndValidate(file, raw);
    if (!ok || !harness) process.exit(1);

    const { svg, width, height } = renderHarnessSvg(harness);
    const base = file.replace(/\.harness\.json$|\.json$/, "");

    if (opts.svg) {
      const out = opts.output ?? `${base}.svg`;
      await fs.writeFile(out, svg, "utf8");
      console.log(`✓ wrote ${out}`);
      return;
    }

    const out = opts.output ?? `${base}.pdf`;
    const { default: PDFDocument } = await import("pdfkit");
    const { default: SVGtoPDF } = await import("svg-to-pdfkit");
    // SVG px (96/in) -> PDF pt (72/in)
    const ptW = (width * 72) / 96;
    const ptH = (height * 72) / 96;
    const doc = new PDFDocument({ size: [ptW, ptH], margin: 0 });
    const stream = createWriteStream(out);
    doc.pipe(stream);
    SVGtoPDF(doc, svg, 0, 0, {
      width: ptW,
      height: ptH,
      preserveAspectRatio: "xMidYMid meet",
      fontCallback: (_family: string, bold: boolean) => (bold ? "Helvetica-Bold" : "Helvetica"),
    });
    doc.end();
    await new Promise<void>((resolve, reject) => {
      stream.on("finish", () => resolve());
      stream.on("error", reject);
    });
    console.log(`✓ wrote ${out}`);
  });

function csv(rows: string[][]): string {
  const cell = (v: string) => (/[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
  return rows.map((r) => r.map(cell).join(",")).join("\n") + "\n";
}

program
  .command("tables")
  .description("Export the wiring table and BOM as CSV files for manufacturing")
  .argument("<file>", "harness JSON file")
  .option("-o, --out-dir <dir>", "output directory (default: alongside the input)")
  .action(async (file: string, opts: { outDir?: string }) => {
    const raw = await fs.readFile(file, "utf8");
    const { harness, ok } = loadAndValidate(file, raw);
    if (!ok || !harness) process.exit(1);

    const base = path.basename(file).replace(/\.harness\.json$|\.json$/, "");
    const dir = opts.outDir ?? path.dirname(file);
    await fs.mkdir(dir, { recursive: true });

    // Partner wires per wire (twisted groups), like harness.design's "Twisted With"
    const twistedWith = new Map<string, string[]>();
    for (const group of harness.wireGroups ?? []) {
      if (!group.twisted) continue;
      for (const w of group.wires) {
        twistedWith.set(w, group.wires.filter((x) => x !== w));
      }
    }

    const wiring = buildWireList(harness);
    const wiringCsv = csv([
      ["Wire", "From", "To", "Gauge", "Color", "Length (mm)", "Twisted With", "Notes"],
      ...wiring.map((row, i) => [
        row.wire,
        row.from,
        row.to,
        row.gauge,
        row.color,
        String(row.lengthMm),
        (twistedWith.get(harness.wires[i].id) ?? []).join(" "),
        row.notes,
      ]),
    ]);
    const wiringPath = path.join(dir, `${base}.wiring.csv`);
    await fs.writeFile(wiringPath, wiringCsv, "utf8");
    console.log(`✓ wrote ${wiringPath}`);

    const bom = buildBom(harness, harness.parts ?? {});
    const bomCsv = csv([
      ["Item", "Qty", "Part Number", "Description", "Manufacturer", "Source"],
      ...bom.map((r) => [String(r.item), r.qty, r.mpn, r.description, r.manufacturer, r.source]),
    ]);
    const bomPath = path.join(dir, `${base}.bom.csv`);
    await fs.writeFile(bomPath, bomCsv, "utf8");
    console.log(`✓ wrote ${bomPath}`);
  });

const parts = program.command("parts").description("Source components from LCSC, Mouser, and Digi-Key");

parts
  .command("fetch")
  .description("Resolve every part reference against its distributor and embed the data in the file")
  .argument("<files...>", "harness JSON files")
  .option("--refresh", "re-fetch parts that are already resolved")
  .action(async (files: string[], opts: { refresh?: boolean }) => {
    const config = await loadConfig();
    let failed = 0;
    for (const file of files) {
      let harness: Harness;
      try {
        harness = JSON.parse(await fs.readFile(file, "utf8")) as Harness;
      } catch (err) {
        console.error(`✗ ${file}: ${(err as Error).message}`);
        failed++;
        continue;
      }
      const cache: PartsCache = { ...(harness.parts ?? {}) };
      const refs = collectPartRefs(harness);
      if (refs.length === 0) {
        console.log(`  ${file}: no part references`);
        continue;
      }
      let changed = false;
      for (const ref of refs) {
        const key = partKey(ref);
        if (cache[key] && !opts.refresh) {
          console.log(`  ✓ ${formatSource(ref)} (cached) ${cache[key].mpn}`);
          continue;
        }
        try {
          const resolved = await resolvePart(ref, config);
          cache[key] = resolved;
          changed = true;
          console.log(`  ✓ ${formatSource(ref)} → ${resolved.manufacturer} ${resolved.mpn}`);
        } catch (err) {
          console.error(`  ✗ ${formatSource(ref)}: ${(err as Error).message}`);
          failed++;
        }
      }
      // Prune cache entries no longer referenced
      const wanted = new Set(refs.map(partKey));
      for (const key of Object.keys(cache)) {
        if (!wanted.has(key)) {
          delete cache[key];
          changed = true;
        }
      }
      if (changed) {
        harness.parts = cache;
        await fs.writeFile(file, JSON.stringify(harness, null, 2) + "\n", "utf8");
        console.log(`✓ ${file}: parts embedded`);
      }
    }
    if (failed > 0) process.exit(1);
  });

const config = program
  .command("config")
  .description("Manage distributor API keys (Mouser, Digi-Key; LCSC needs no key)");

config
  .command("set")
  .description("Set an API key, e.g. `config set mouser.apiKey <key>`")
  .argument("<key>", "mouser.apiKey | digikey.clientId | digikey.clientSecret")
  .argument("<value>")
  .action(async (key: string, value: string) => {
    try {
      await saveConfigValue(key, value);
      console.log(`✓ saved ${key} to ${CONFIG_PATH}`);
    } catch (err) {
      console.error(`✗ ${(err as Error).message}`);
      process.exit(1);
    }
  });

config
  .command("list")
  .description("Show configured keys (masked)")
  .action(async () => {
    const cfg = await loadConfig();
    const mask = (v?: string) => (v ? `${v.slice(0, 4)}…${v.slice(-4)}` : "(not set)");
    console.log(`config file: ${CONFIG_PATH}`);
    console.log(`  mouser.apiKey        ${mask(cfg.mouser?.apiKey)}`);
    console.log(`  digikey.clientId     ${mask(cfg.digikey?.clientId)}`);
    console.log(`  digikey.clientSecret ${mask(cfg.digikey?.clientSecret)}`);
    console.log(`  lcsc                 no key required`);
  });

const MIME: Record<string, string> = {
  ".html": "text/html",
  ".js": "text/javascript",
  ".css": "text/css",
  ".svg": "image/svg+xml",
  ".json": "application/json",
  ".png": "image/png",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2",
};

function findAppDist(): string | null {
  try {
    const appPkg = require.resolve("@almond-bot/harness-studio-app/package.json");
    return path.join(path.dirname(appPkg), "dist");
  } catch {
    return null;
  }
}

program
  .command("dev", { isDefault: true })
  .description("Serve the harness viewer with live reload over a folder of harness JSON files")
  .argument("[dir]", "folder containing *.harness.json files", ".")
  .option("-p, --port <port>", "port", "4321")
  .action(async (dir: string, opts: { port: string }) => {
    const dataDir = path.resolve(dir);
    const appDist = findAppDist();
    if (!appDist) {
      console.error("viewer app build not found; run `npm run build` first");
      process.exit(1);
    }
    const api = createApiHandler(dataDir);

    const server = http.createServer(async (req, res) => {
      await api(req, res, async () => {
        const url = new URL(req.url ?? "/", "http://localhost");
        let filePath = path.join(appDist, url.pathname === "/" ? "index.html" : url.pathname);
        try {
          await fs.access(filePath);
        } catch {
          filePath = path.join(appDist, "index.html");
        }
        try {
          const content = await fs.readFile(filePath);
          res.setHeader("Content-Type", MIME[path.extname(filePath)] ?? "application/octet-stream");
          res.end(content);
        } catch {
          res.statusCode = 404;
          res.end("not found");
        }
      });
    });

    const port = Number(opts.port);
    server.listen(port, () => {
      console.log(`almond-harness-studio`);
      console.log(`  data:    ${dataDir}`);
      console.log(`  viewer:  http://localhost:${port}`);
    });
  });

program.parseAsync(process.argv);
