import type { Harness, PartsCache, ResolvedPart, SheetSize, TerminalNode } from "./types.js";
import { partKey } from "./types.js";
import { layoutHarness, CONNECTOR_HEADER, PIN_ROW, type LayoutResult, type NodeBox, type Point } from "./layout.js";
import { parseWireColor } from "./colors.js";
import { buildBom, buildWireList } from "./bom.js";

const FONT = "Helvetica, Arial, sans-serif";

const SHEETS: Record<SheetSize, { width: number; height: number }> = {
  "ANSI B": { width: 1632, height: 1056 },
  Letter: { width: 1056, height: 816 },
  A3: { width: 1587, height: 1123 },
  A4: { width: 1123, height: 794 },
};

function esc(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function fmt(n: number): string {
  return String(Math.round(n * 100) / 100);
}

interface TextOpts {
  size?: number;
  weight?: "normal" | "bold";
  anchor?: "start" | "middle" | "end";
  fill?: string;
}

function text(x: number, y: number, str: string, opts: TextOpts = {}): string {
  const { size = 10, weight = "normal", anchor = "start", fill = "#111" } = opts;
  return `<text x="${fmt(x)}" y="${fmt(y)}" font-family="${FONT}" font-size="${size}" font-weight="${weight}" text-anchor="${anchor}" fill="${fill}">${esc(str)}</text>`;
}

/** Truncate to fit a column so table cells never spill into their neighbors. */
function fitText(value: string, widthPx: number, fontSize: number): string {
  const maxChars = Math.floor((widthPx - 10) / (fontSize * 0.56));
  if (value.length <= maxChars) return value;
  return value.slice(0, Math.max(1, maxChars - 1)).trimEnd() + "…";
}

interface Column {
  title: string;
  width: number;
  align?: "start" | "middle" | "end";
}

const TABLE_ROW_H = 16;
const TABLE_HEADER_H = 18;

function tableHeight(rowCount: number, title?: string): number {
  return (title ? 16 : 0) + TABLE_HEADER_H + rowCount * TABLE_ROW_H;
}

function renderTable(x: number, y: number, columns: Column[], rows: string[][], title?: string): string {
  const width = columns.reduce((s, c) => s + c.width, 0);
  const parts: string[] = [];
  let top = y;
  if (title) {
    parts.push(text(x, top + 11, title, { size: 10, weight: "bold" }));
    top += 16;
  }
  const height = TABLE_HEADER_H + rows.length * TABLE_ROW_H;
  parts.push(
    `<rect x="${fmt(x)}" y="${fmt(top)}" width="${width}" height="${height}" fill="white" stroke="#111" stroke-width="1"/>`
  );
  parts.push(
    `<rect x="${fmt(x)}" y="${fmt(top)}" width="${width}" height="${TABLE_HEADER_H}" fill="#ececec" stroke="#111" stroke-width="1"/>`
  );
  let cx = x;
  columns.forEach((col, i) => {
    const alignX = col.align === "end" ? cx + col.width - 5 : col.align === "middle" ? cx + col.width / 2 : cx + 5;
    parts.push(text(alignX, top + 12.5, col.title, { size: 8.5, weight: "bold", anchor: col.align ?? "start" }));
    if (i > 0) {
      parts.push(
        `<line x1="${fmt(cx)}" y1="${fmt(top)}" x2="${fmt(cx)}" y2="${fmt(top + height)}" stroke="#111" stroke-width="0.75"/>`
      );
    }
    cx += col.width;
  });
  rows.forEach((row, r) => {
    const ry = top + TABLE_HEADER_H + r * TABLE_ROW_H;
    if (r > 0) {
      parts.push(
        `<line x1="${fmt(x)}" y1="${fmt(ry)}" x2="${fmt(x + width)}" y2="${fmt(ry)}" stroke="#999" stroke-width="0.5"/>`
      );
    }
    let cellX = x;
    columns.forEach((col, c) => {
      const value = fitText(row[c] ?? "", col.width, 8.5);
      const alignX =
        col.align === "end" ? cellX + col.width - 5 : col.align === "middle" ? cellX + col.width / 2 : cellX + 5;
      parts.push(text(alignX, ry + 11.5, value, { size: 8.5, anchor: col.align ?? "start" }));
      cellX += col.width;
    });
  });
  return parts.join("\n");
}

function terminalShortDesc(node: TerminalNode): string {
  const names: Record<TerminalNode["style"], string> = {
    ring: "RING",
    spade: "SPADE",
    ferrule: "FERRULE",
    tinned: "TINNED",
    bare: "BARE",
    "solder-cup": "SOLDER CUP",
    pin: "PIN",
  };
  return node.stud ? `${names[node.style]} ${node.stud}` : names[node.style];
}

function renderTerminalSymbol(box: NodeBox, resolved?: ResolvedPart): string {
  const node = box.node as TerminalNode;
  // Symbol sits exactly on the box centerline so it meets the incoming wire
  const cy = box.y + box.height / 2;
  const anchorX = box.facesRight ? box.x + box.width : box.x;
  const symX = box.facesRight ? box.x + box.width - 16 : box.x + 16;
  const tailDir = box.facesRight ? 1 : -1;
  const parts: string[] = [];
  const stroke = `stroke="#111" stroke-width="1.5" fill="none"`;

  parts.push(
    `<line x1="${fmt(anchorX)}" y1="${fmt(cy)}" x2="${fmt(symX)}" y2="${fmt(cy)}" stroke="#111" stroke-width="1.5"/>`
  );
  switch (node.style) {
    case "ring":
      parts.push(`<circle cx="${fmt(symX - tailDir * 9)}" cy="${fmt(cy)}" r="9" ${stroke}/>`);
      parts.push(`<circle cx="${fmt(symX - tailDir * 9)}" cy="${fmt(cy)}" r="3.5" ${stroke}/>`);
      break;
    case "spade": {
      const sx = symX - tailDir * 4;
      const open = -tailDir * 14;
      parts.push(
        `<path d="M ${fmt(sx)} ${fmt(cy - 7)} L ${fmt(sx + open)} ${fmt(cy - 7)} M ${fmt(sx)} ${fmt(cy + 7)} L ${fmt(sx + open)} ${fmt(cy + 7)} M ${fmt(sx)} ${fmt(cy - 7)} A 7 7 0 0 ${tailDir > 0 ? 1 : 0} ${fmt(sx)} ${fmt(cy + 7)}" ${stroke}/>`
      );
      break;
    }
    case "ferrule":
      parts.push(
        `<rect x="${fmt(symX - (tailDir > 0 ? 16 : 0))}" y="${fmt(cy - 4)}" width="16" height="8" ${stroke}/>`,
        `<line x1="${fmt(symX - tailDir * 16)}" y1="${fmt(cy)}" x2="${fmt(symX - tailDir * 24)}" y2="${fmt(cy)}" stroke="#111" stroke-width="2.5"/>`
      );
      break;
    case "tinned":
      parts.push(
        `<line x1="${fmt(symX)}" y1="${fmt(cy)}" x2="${fmt(symX - tailDir * 18)}" y2="${fmt(cy)}" stroke="#111" stroke-width="3.5"/>`
      );
      break;
    case "bare":
      for (const dy of [-5, 0, 5]) {
        parts.push(
          `<line x1="${fmt(symX)}" y1="${fmt(cy)}" x2="${fmt(symX - tailDir * 16)}" y2="${fmt(cy + dy)}" stroke="#111" stroke-width="1"/>`
        );
      }
      break;
    case "solder-cup":
      parts.push(
        `<path d="M ${fmt(symX)} ${fmt(cy - 6)} A 6 6 0 1 ${tailDir > 0 ? 0 : 1} ${fmt(symX)} ${fmt(cy + 6)}" ${stroke}/>`
      );
      break;
    case "pin":
      parts.push(
        `<rect x="${fmt(symX - (tailDir > 0 ? 18 : 0))}" y="${fmt(cy - 2.5)}" width="18" height="5" ${stroke}/>`
      );
      break;
  }
  const labelX = box.x + box.width / 2;
  const desc = resolved?.mpn ? `${terminalShortDesc(node)} · ${resolved.mpn}` : terminalShortDesc(node);
  parts.push(text(labelX, box.y + box.height + 6, `${node.id} · ${desc}`, { size: 9, weight: "bold", anchor: "middle" }));
  return parts.join("\n");
}

function resolvedFor(node: { part?: { vendor: string; number: string } }, parts: PartsCache): ResolvedPart | undefined {
  if (!node.part) return undefined;
  return parts[partKey(node.part as Parameters<typeof partKey>[0])];
}

/**
 * Part photo rendered next to the node symbol, like pictorial views on
 * manufacturing drawings. Root-side nodes get the photo above the box; leaf
 * nodes get it on the outward side so it stays clear of incoming wires.
 */
function renderPartPhoto(box: NodeBox, resolved: ResolvedPart | undefined): string {
  if (!resolved?.image) return "";
  const size = 64;
  let x: number;
  let y: number;
  if (box.facesRight) {
    x = box.x + (box.width - size) / 2;
    y = box.y - size - 14;
  } else {
    x = box.x + box.width + 12;
    y = box.y + box.height / 2 - size / 2;
  }
  return (
    `<image x="${fmt(x)}" y="${fmt(y)}" width="${size}" height="${size}" href="${resolved.image}" preserveAspectRatio="xMidYMid meet"/>` +
    `<rect x="${fmt(x)}" y="${fmt(y)}" width="${size}" height="${size}" fill="none" stroke="#ccc" stroke-width="0.75"/>`
  );
}

function renderNode(box: NodeBox, partsCache: PartsCache): string {
  const node = box.node;
  const parts: string[] = [];
  if (node.kind === "connector") {
    const resolved = resolvedFor(node, partsCache);
    parts.push(renderPartPhoto(box, resolved));
    parts.push(
      `<rect x="${fmt(box.x)}" y="${fmt(box.y)}" width="${box.width}" height="${box.height}" fill="white" stroke="#111" stroke-width="1.5"/>`
    );
    parts.push(
      `<rect x="${fmt(box.x)}" y="${fmt(box.y)}" width="${box.width}" height="${CONNECTOR_HEADER}" fill="#f0f0f0" stroke="#111" stroke-width="1.5"/>`
    );
    parts.push(text(box.x + 6, box.y + 14, node.id, { size: 11, weight: "bold" }));
    const sub = resolved?.mpn ?? `${node.part.vendor.toUpperCase()} ${node.part.number}`;
    parts.push(text(box.x + 6, box.y + 27, sub, { size: 8, fill: "#333" }));

    const pinCellW = 24;
    const pinCellX = box.facesRight ? box.x + box.width - pinCellW : box.x;
    node.pins.forEach((pin, i) => {
      const rowY = box.y + CONNECTOR_HEADER + i * PIN_ROW;
      if (i > 0) {
        parts.push(
          `<line x1="${fmt(box.x)}" y1="${fmt(rowY)}" x2="${fmt(box.x + box.width)}" y2="${fmt(rowY)}" stroke="#bbb" stroke-width="0.5"/>`
        );
      }
      parts.push(
        `<rect x="${fmt(pinCellX)}" y="${fmt(rowY)}" width="${pinCellW}" height="${PIN_ROW}" fill="#fafafa" stroke="#bbb" stroke-width="0.5"/>`
      );
      parts.push(text(pinCellX + pinCellW / 2, rowY + 12.5, pin.id, { size: 9, weight: "bold", anchor: "middle" }));
      if (pin.label) {
        const labelX = box.facesRight ? box.x + 6 : box.x + pinCellW + 6;
        parts.push(text(labelX, rowY + 12.5, pin.label, { size: 8.5 }));
      }
    });
  } else if (node.kind === "terminal") {
    const resolved = resolvedFor(node, partsCache);
    parts.push(renderPartPhoto(box, resolved));
    parts.push(renderTerminalSymbol(box, resolved));
  } else if (node.kind === "splice") {
    const cx = box.x + box.width / 2;
    const cy = box.y + box.height / 2;
    parts.push(`<circle cx="${fmt(cx)}" cy="${fmt(cy)}" r="6" fill="#111"/>`);
    const label = node.method ? `${node.id} (${node.method.toUpperCase()})` : node.id;
    parts.push(text(cx, box.y - 4, label, { size: 8.5, weight: "bold", anchor: "middle" }));
  } else {
    const cx = box.x + box.width / 2;
    const cy = box.y + box.height / 2;
    parts.push(`<circle cx="${fmt(cx)}" cy="${fmt(cy)}" r="4.5" fill="#333"/>`);
    parts.push(text(cx, box.y - 4, node.id, { size: 8, anchor: "middle", fill: "#555" }));
  }
  return parts.join("\n");
}

const COVERING_LABELS: Record<string, string> = {
  heatshrink: "HEATSHRINK",
  "pet-braid": "PET BRAID",
  "split-loom": "SPLIT LOOM",
  "spiral-wrap": "SPIRAL WRAP",
};

function renderSegments(layout: LayoutResult): string {
  const parts: string[] = [];
  for (const line of layout.segmentLines.values()) {
    const { from, to, segment } = line;
    const dx = to.x - from.x;
    const dy = to.y - from.y;
    const len = Math.hypot(dx, dy);
    const angle = (Math.atan2(dy, dx) * 180) / Math.PI;
    const bandH = Math.max(12, line.wires.length * 4 + 8);

    let bandFill = "#e9e9e9";
    let extras = "";
    if (segment.covering === "heatshrink") bandFill = "#d7e7f7";
    else if (segment.covering === "pet-braid") bandFill = "url(#petBraid)";
    else if (segment.covering === "spiral-wrap") bandFill = "url(#spiralWrap)";
    else if (segment.covering === "split-loom") bandFill = "#dcdcdc";
    if (segment.covering && segment.covering !== "none") {
      extras = `<rect x="0" y="${fmt(-bandH / 2)}" width="${fmt(len)}" height="${bandH}" fill="none" stroke="#666" stroke-width="1"${segment.covering === "split-loom" ? ` stroke-dasharray="6 3"` : ""}/>`;
    }
    parts.push(
      `<g transform="translate(${fmt(from.x)} ${fmt(from.y)}) rotate(${fmt(angle)})">` +
        `<rect x="0" y="${fmt(-bandH / 2)}" width="${fmt(len)}" height="${bandH}" fill="${bandFill}"/>` +
        extras +
        `</g>`
    );

    const mx = (from.x + to.x) / 2;
    const my = (from.y + to.y) / 2;
    const labelParts = [`${segment.id} · ${segment.lengthMm} mm`];
    if (segment.covering && segment.covering !== "none") {
      labelParts.push(COVERING_LABELS[segment.covering] ?? segment.covering.toUpperCase());
    }
    parts.push(text(mx, my + bandH / 2 + 12, labelParts[0], { size: 8.5, anchor: "middle", fill: "#333" }));
    if (labelParts[1]) {
      parts.push(text(mx, my + bandH / 2 + 22, labelParts[1], { size: 7.5, anchor: "middle", fill: "#666" }));
    }
  }
  return parts.join("\n");
}

function polylinePath(points: Point[]): string {
  return points.map((p, i) => `${i === 0 ? "M" : "L"} ${fmt(p.x)} ${fmt(p.y)}`).join(" ");
}

function renderWires(harness: Harness, layout: LayoutResult): string {
  const parts: string[] = [];
  for (const wire of harness.wires) {
    const path = layout.wirePaths.get(wire.id);
    if (!path || path.points.length < 2) continue;
    const color = parseWireColor(wire.color);
    const d = polylinePath(path.points);
    const light = color.base === "#f2f2f2" || color.base === "#e6c700";
    if (light) {
      parts.push(`<path d="${d}" fill="none" stroke="#999" stroke-width="3" stroke-linejoin="round"/>`);
    }
    parts.push(
      `<path d="${d}" fill="none" stroke="${color.base}" stroke-width="2" stroke-linejoin="round"/>`
    );
    if (color.stripe) {
      parts.push(
        `<path d="${d}" fill="none" stroke="${color.stripe}" stroke-width="2" stroke-dasharray="5 5" stroke-linejoin="round"/>`
      );
    }
  }
  return parts.join("\n");
}

function renderTwistMarks(harness: Harness, layout: LayoutResult): string {
  const parts: string[] = [];
  (harness.wireGroups ?? []).forEach((group, i) => {
    if (!group.twisted) return;
    const label = group.label ?? group.id ?? `TW${i + 1}`;
    // Find a segment shared by all wires in the group
    const routes = group.wires.map((w) => layout.wirePaths.get(w)?.routeSegments ?? []);
    const shared = routes[0]?.find((segId) => routes.every((r) => r.includes(segId)));
    if (!shared) return;
    const line = layout.segmentLines.get(shared);
    if (!line) return;
    const mx = (line.from.x + line.to.x) / 2;
    const my = (line.from.y + line.to.y) / 2;
    const angle = (Math.atan2(line.to.y - line.from.y, line.to.x - line.from.x) * 180) / Math.PI;

    // Two antiphase waves crossing each other = the classic twisted-pair braid.
    // When the group is a pair, draw each strand in its actual wire color.
    const waveA = "M -24 -2 Q -16 7 -8 -2 Q 0 7 8 -2 Q 16 7 24 -2";
    const waveB = "M -24 2 Q -16 -7 -8 2 Q 0 -7 8 2 Q 16 -7 24 2";
    const groupWires = group.wires
      .map((id) => harness.wires.find((w) => w.id === id))
      .filter((w) => w !== undefined);
    const strandColor = (idx: number): string => {
      if (groupWires.length !== 2) return "#111";
      return parseWireColor(groupWires[idx]!.color).base;
    };
    const strand = (d: string, color: string): string => {
      const light = color === "#f2f2f2" || color === "#e6c700";
      const halo = light
        ? `<path d="${d}" fill="none" stroke="#999" stroke-width="3" stroke-linecap="round"/>`
        : "";
      return `${halo}<path d="${d}" fill="none" stroke="${color}" stroke-width="2" stroke-linecap="round"/>`;
    };
    parts.push(
      `<g transform="translate(${fmt(mx)} ${fmt(my)}) rotate(${fmt(angle)})">` +
        `<rect x="-26" y="-9" width="52" height="18" fill="white"/>` +
        strand(waveA, strandColor(0)) +
        strand(waveB, strandColor(1)) +
        `<rect x="-14" y="-26" width="28" height="12" fill="white" stroke="#111" stroke-width="0.75"/>` +
        text(0, -16.5, label, { size: 8, weight: "bold", anchor: "middle" }) +
        `</g>`
    );
  });
  return parts.join("\n");
}

function renderTitleBlock(x: number, y: number, w: number, h: number, harness: Harness, sheet: SheetSize): string {
  const meta = harness.meta;
  const parts: string[] = [];
  const row1 = h * 0.42;
  const row2 = (h - row1) / 2;
  parts.push(`<rect x="${fmt(x)}" y="${fmt(y)}" width="${w}" height="${h}" fill="white" stroke="#111" stroke-width="1.5"/>`);

  const field = (fx: number, fy: number, fw: number, fh: number, caption: string, value: string, valueSize = 10) => {
    parts.push(`<rect x="${fmt(fx)}" y="${fmt(fy)}" width="${fmt(fw)}" height="${fmt(fh)}" fill="none" stroke="#111" stroke-width="0.75"/>`);
    parts.push(text(fx + 4, fy + 9, caption, { size: 6, fill: "#666" }));
    parts.push(text(fx + 4, fy + fh - 5, value, { size: valueSize, weight: "bold" }));
  };

  field(x, y, w, row1, "TITLE", meta.title, 13);
  const c1 = w * 0.42;
  const c2 = w * 0.18;
  const c3 = w * 0.2;
  const c4 = w - c1 - c2 - c3;
  field(x, y + row1, c1, row2, "PART NUMBER", meta.partNumber ?? "—");
  field(x + c1, y + row1, c2, row2, "REV", meta.rev ?? "—");
  field(x + c1 + c2, y + row1, c3, row2, "DATE", meta.date ?? "—");
  field(x + c1 + c2 + c3, y + row1, c4, row2, "SCALE", "NTS");
  field(x, y + row1 + row2, c1, row2, "COMPANY", meta.company ?? "—");
  field(x + c1, y + row1 + row2, c2 + c3, row2, "DRAWN BY", meta.drawnBy ?? "—");
  field(x + c1 + c2 + c3, y + row1 + row2, c4, row2, "SHEET", sheet);
  return parts.join("\n");
}

export interface RenderResult {
  svg: string;
  width: number;
  height: number;
}

export function renderHarnessSvg(harness: Harness): RenderResult {
  const sheet: SheetSize = harness.meta.sheet ?? "ANSI B";
  const { width: W, height: H } = SHEETS[sheet];
  const margin = 18;
  const frame = { x: margin, y: margin, w: W - margin * 2, h: H - margin * 2 };

  const partsCache = harness.parts ?? {};
  const layout = layoutHarness(harness);
  const bom = buildBom(harness, partsCache);
  const wireList = buildWireList(harness);

  const parts: string[] = [];
  parts.push(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" font-family="${FONT}">`
  );
  parts.push(
    `<defs>` +
      `<pattern id="petBraid" width="7" height="7" patternUnits="userSpaceOnUse">` +
      `<rect width="7" height="7" fill="#efefef"/>` +
      `<path d="M 0 7 L 7 0 M 0 0 L 7 7" stroke="#b5b5b5" stroke-width="0.8"/>` +
      `</pattern>` +
      `<pattern id="spiralWrap" width="8" height="8" patternUnits="userSpaceOnUse">` +
      `<rect width="8" height="8" fill="#efefef"/>` +
      `<path d="M 0 8 L 8 0" stroke="#b5b5b5" stroke-width="1.5"/>` +
      `</pattern>` +
      `</defs>`
  );
  parts.push(`<rect x="0" y="0" width="${W}" height="${H}" fill="white"/>`);
  parts.push(
    `<rect x="${frame.x}" y="${frame.y}" width="${frame.w}" height="${frame.h}" fill="none" stroke="#111" stroke-width="2"/>`
  );

  // BOM: top-right
  const bomCols: Column[] = [
    { title: "ITEM", width: 34, align: "middle" },
    { title: "QTY", width: 56, align: "middle" },
    { title: "PART NUMBER", width: 130 },
    { title: "DESCRIPTION", width: 190 },
    { title: "SOURCE", width: 118 },
  ];
  const bomW = bomCols.reduce((s, c) => s + c.width, 0);
  const bomX = frame.x + frame.w - bomW - 10;
  const bomY = frame.y + 10;
  parts.push(
    renderTable(
      bomX,
      bomY,
      bomCols,
      bom.map((r) => [String(r.item), r.qty, r.mpn, r.description, r.source]),
      "BILL OF MATERIALS"
    )
  );

  // Title block: bottom-right
  const tbW = 400;
  const tbH = 92;
  const tbX = frame.x + frame.w - tbW;
  const tbY = frame.y + frame.h - tbH;
  parts.push(renderTitleBlock(tbX, tbY, tbW, tbH, harness, sheet));

  // Wire list: bottom-left
  const wlCols: Column[] = [
    { title: "WIRE", width: 44, align: "middle" },
    { title: "FROM", width: 70 },
    { title: "TO", width: 70 },
    { title: "GAUGE", width: 56, align: "middle" },
    { title: "COLOR", width: 74, align: "middle" },
    { title: "LEN (MM)", width: 58, align: "middle" },
    { title: "NOTES", width: 128 },
  ];
  const wlW = wlCols.reduce((s, c) => s + c.width, 0);
  const wlH = tableHeight(wireList.length, "WIRE LIST");
  const wlX = frame.x + 10;
  const wlY = frame.y + frame.h - wlH - 10;
  parts.push(
    renderTable(
      wlX,
      wlY,
      wlCols,
      wireList.map((r) => [r.wire, r.from, r.to, r.gauge, r.color, String(r.lengthMm), r.notes]),
      "WIRE LIST"
    )
  );

  // Notes: between wire list and title block
  const notes = harness.notes ?? [];
  if (notes.length > 0) {
    const nX = wlX + wlW + 24;
    let nY = frame.y + frame.h - 10 - notes.length * 13 - 16;
    parts.push(text(nX, nY, "NOTES:", { size: 10, weight: "bold" }));
    notes.forEach((note, i) => {
      parts.push(text(nX, nY + 15 + i * 13, `${i + 1}. ${note}`, { size: 9 }));
    });
  }

  // Drawing area: center on the sheet (above the bottom band); if the drawing
  // would collide with the BOM in the top-right, fall back to the region left of it.
  const bottomBand = Math.max(wlH, tbH) + 24;
  const b = { ...layout.bounds };
  // Part photos render above root-side nodes and beside leaf nodes; reserve room
  const hasPhotos = harness.nodes.some(
    (n) => "part" in n && n.part && partsCache[partKey(n.part)]?.image
  );
  if (hasPhotos) {
    b.y -= 80;
    b.height += 80;
    b.width += 80;
  }
  const pad = 30;
  const availY = frame.y + 20;
  const availH = frame.h - bottomBand - 40;
  let scale = Math.min((frame.w - 40) / (b.width + pad * 2), availH / (b.height + pad * 2), 1.25);
  let tx = frame.x + (frame.w - b.width * scale) / 2 - b.x * scale;
  let ty = availY + (availH - b.height * scale) / 2 - b.y * scale;

  const bomH = tableHeight(bom.length, "BILL OF MATERIALS");
  const drawRight = tx + (b.x + b.width) * scale;
  const drawTop = ty + b.y * scale;
  if (drawRight > bomX - 20 && drawTop < bomY + bomH + 20) {
    const safeW = frame.w - bomW - 60;
    scale = Math.min(safeW / (b.width + pad * 2), availH / (b.height + pad * 2), 1.25);
    tx = frame.x + 20 + (safeW - b.width * scale) / 2 - b.x * scale;
    ty = availY + (availH - b.height * scale) / 2 - b.y * scale;
  }

  parts.push(`<g transform="translate(${fmt(tx)} ${fmt(ty)}) scale(${fmt(scale)})">`);
  parts.push(renderSegments(layout));
  parts.push(renderWires(harness, layout));
  parts.push(renderTwistMarks(harness, layout));
  for (const box of layout.boxes.values()) parts.push(renderNode(box, partsCache));
  parts.push(`</g>`);

  parts.push(
    text(frame.x + 4, H - 6, "Generated by almond-harness-studio", { size: 7, fill: "#999" })
  );
  parts.push(`</svg>`);

  return { svg: parts.join("\n"), width: W, height: H };
}
