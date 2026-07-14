#!/usr/bin/env node
import { promises as fs } from "node:fs";
import { createWriteStream } from "node:fs";
import http from "node:http";
import path from "node:path";
import { createRequire } from "node:module";
import { Command } from "commander";
import { validateHarness, renderHarnessSvg, type Harness } from "@almond-harness-studio/core";
import { createApiHandler } from "./middleware.js";

const program = new Command();
program
  .name("almond-harness-studio")
  .description("Wire harness drawings from JSON: live preview, validation, and PDF export")
  .version("0.1.0");

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
    const require = createRequire(import.meta.url);
    const appPkg = require.resolve("@almond-harness-studio/app/package.json");
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
