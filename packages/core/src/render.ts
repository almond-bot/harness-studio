import type {
  ConnectorNode,
  Harness,
  InlineComponentNode,
  PartsCache,
  ResolvedPart,
  SheetSize,
  TerminalNode,
} from "./types.js";
import { parseEndpoint, partKey } from "./types.js";
import { layoutHarness, CONNECTOR_HEADER, PIN_ROW, type LayoutResult, type NodeBox, type Point } from "./layout.js";
import { parseWireColor } from "./colors.js";
import { buildBom, buildWireList } from "./bom.js";

const FONT = "Helvetica, Arial, sans-serif";

export type RenderTheme = "light" | "dark";

export interface RenderOptions {
  /**
   * "light" is the manufacturing drawing (white sheet) and the only theme
   * exports should use; "dark" exists for on-screen previews.
   */
  theme?: RenderTheme;
}

interface ThemeColors {
  paper: string;
  ink: string;
  textMuted: string;
  textSoft: string;
  textDim: string;
  textFaint: string;
  tableHeader: string;
  panel: string;
  panelSoft: string;
  cardStroke: string;
  band: string;
  bandHeatshrink: string;
  bandLoom: string;
  bandStroke: string;
  patternBg: string;
  patternFg: string;
  shieldBraidBg: string;
  shieldBraidFg: string;
  shieldFoilBg: string;
  shieldFoilFg: string;
  cableJacket: string;
  cableInner: string;
  /** Wire base colors that need a contrast outline against the paper */
  outlinedWires: string[];
  wireOutline: string;
}

const THEMES: Record<RenderTheme, ThemeColors> = {
  light: {
    paper: "white",
    ink: "#111",
    textMuted: "#333",
    textSoft: "#555",
    textDim: "#666",
    textFaint: "#999",
    tableHeader: "#ececec",
    panel: "#f0f0f0",
    panelSoft: "#fafafa",
    cardStroke: "#d0d0d0",
    band: "#e9e9e9",
    bandHeatshrink: "#d7e7f7",
    bandLoom: "#dcdcdc",
    bandStroke: "#666",
    patternBg: "#efefef",
    patternFg: "#b5b5b5",
    shieldBraidBg: "#e2e2e2",
    shieldBraidFg: "#8a8a8a",
    shieldFoilBg: "#e8e8e8",
    shieldFoilFg: "#9a9a9a",
    cableJacket: "#4a4a4a",
    cableInner: "#f6f6f6",
    outlinedWires: ["#f2f2f2", "#e6c700"],
    wireOutline: "#999",
  },
  dark: {
    paper: "#18181a",
    ink: "#e6e6e6",
    textMuted: "#c4c4c4",
    textSoft: "#a8a8a8",
    textDim: "#9a9a9a",
    textFaint: "#767676",
    tableHeader: "#2a2a2d",
    panel: "#2a2a2d",
    panelSoft: "#202023",
    cardStroke: "#3f3f42",
    band: "#2c2c2f",
    bandHeatshrink: "#243447",
    bandLoom: "#2e2e31",
    bandStroke: "#8a8a8a",
    patternBg: "#26262a",
    patternFg: "#6e6e72",
    shieldBraidBg: "#2c2c2f",
    shieldBraidFg: "#87878b",
    shieldFoilBg: "#2b2b2e",
    shieldFoilFg: "#808084",
    cableJacket: "#7a7a7e",
    cableInner: "#222226",
    outlinedWires: ["#1a1a1a", "#7b4a12"],
    wireOutline: "#8a8a8a",
  },
};

/** Active palette for the render in progress (rendering is synchronous). */
let T = THEMES.light;

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
  const { size = 10, weight = "normal", anchor = "start", fill = T.ink } = opts;
  return `<text x="${fmt(x)}" y="${fmt(y)}" font-family="${FONT}" font-size="${size}" font-weight="${weight}" text-anchor="${anchor}" fill="${fill}">${esc(str)}</text>`;
}

/** Text with a paper-colored halo so labels stay readable over wires without patch rectangles. */
function haloText(x: number, y: number, str: string, opts: TextOpts = {}): string {
  const { size = 10, weight = "normal", anchor = "start", fill = T.ink } = opts;
  const common = `x="${fmt(x)}" y="${fmt(y)}" font-family="${FONT}" font-size="${size}" font-weight="${weight}" text-anchor="${anchor}"`;
  return (
    `<text ${common} fill="${T.paper}" stroke="${T.paper}" stroke-width="3" stroke-linejoin="round">${esc(str)}</text>` +
    `<text ${common} fill="${fill}">${esc(str)}</text>`
  );
}

/** Truncate to fit a column so table cells never spill into their neighbors. */
function fitText(value: string, widthPx: number, fontSize: number): string {
  const maxChars = Math.floor((widthPx - 10) / (fontSize * 0.56));
  if (value.length <= maxChars) return value;
  return value.slice(0, Math.max(1, maxChars - 1)).trimEnd() + "…";
}

/** Word-wrap to fit a pixel width; words longer than a line are hard-broken. */
function wrapText(value: string, widthPx: number, fontSize: number): string[] {
  const maxChars = Math.max(8, Math.floor(widthPx / (fontSize * 0.56)));
  const lines: string[] = [];
  let current = "";
  for (const word of value.split(/\s+/)) {
    let w = word;
    while (w.length > maxChars) {
      if (current) {
        lines.push(current);
        current = "";
      }
      lines.push(w.slice(0, maxChars));
      w = w.slice(maxChars);
    }
    if (!current) current = w;
    else if (current.length + 1 + w.length <= maxChars) current += " " + w;
    else {
      lines.push(current);
      current = w;
    }
  }
  if (current) lines.push(current);
  return lines.length > 0 ? lines : [""];
}

interface Column {
  title: string;
  width: number;
  align?: "start" | "middle" | "end";
}

const TABLE_ROW_H = 16;
const TABLE_HEADER_H = 18;

/** Single line weights used by every table-like element so linework is uniform. */
const BORDER_W = 1.25;
const GRID_W = 0.5;

function tableHeight(rowCount: number, title?: string): number {
  return (title ? 16 : 0) + TABLE_HEADER_H + rowCount * TABLE_ROW_H;
}

function gridLine(x1: number, y1: number, x2: number, y2: number): string {
  return `<line x1="${fmt(x1)}" y1="${fmt(y1)}" x2="${fmt(x2)}" y2="${fmt(y2)}" stroke="${T.ink}" stroke-width="${GRID_W}"/>`;
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

  // Fills first, then a single pass of uniform grid lines — nothing overlaps
  parts.push(`<rect x="${fmt(x)}" y="${fmt(top)}" width="${width}" height="${height}" fill="${T.paper}"/>`);
  parts.push(`<rect x="${fmt(x)}" y="${fmt(top)}" width="${width}" height="${TABLE_HEADER_H}" fill="${T.tableHeader}"/>`);

  parts.push(gridLine(x, top + TABLE_HEADER_H, x + width, top + TABLE_HEADER_H));
  rows.forEach((_, r) => {
    if (r > 0) {
      const ry = top + TABLE_HEADER_H + r * TABLE_ROW_H;
      parts.push(gridLine(x, ry, x + width, ry));
    }
  });
  let cx = x;
  columns.forEach((col, i) => {
    if (i > 0) parts.push(gridLine(cx, top, cx, top + height));
    const alignX = col.align === "end" ? cx + col.width - 5 : col.align === "middle" ? cx + col.width / 2 : cx + 5;
    parts.push(text(alignX, top + 12.5, col.title, { size: 8.5, weight: "bold", anchor: col.align ?? "start" }));
    cx += col.width;
  });
  parts.push(
    `<rect x="${fmt(x)}" y="${fmt(top)}" width="${width}" height="${height}" fill="none" stroke="${T.ink}" stroke-width="${BORDER_W}"/>`
  );

  rows.forEach((row, r) => {
    const ry = top + TABLE_HEADER_H + r * TABLE_ROW_H;
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
    "quick-connect-male": "QC MALE",
    "quick-connect-female": "QC FEMALE",
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
  const stroke = `stroke="${T.ink}" stroke-width="1.5" fill="none"`;

  parts.push(
    `<line x1="${fmt(anchorX)}" y1="${fmt(cy)}" x2="${fmt(symX)}" y2="${fmt(cy)}" stroke="${T.ink}" stroke-width="1.5"/>`
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
        `<line x1="${fmt(symX - tailDir * 16)}" y1="${fmt(cy)}" x2="${fmt(symX - tailDir * 24)}" y2="${fmt(cy)}" stroke="${T.ink}" stroke-width="2.5"/>`
      );
      break;
    case "tinned":
      parts.push(
        `<line x1="${fmt(symX)}" y1="${fmt(cy)}" x2="${fmt(symX - tailDir * 18)}" y2="${fmt(cy)}" stroke="${T.ink}" stroke-width="3.5"/>`
      );
      break;
    case "bare":
      for (const dy of [-5, 0, 5]) {
        parts.push(
          `<line x1="${fmt(symX)}" y1="${fmt(cy)}" x2="${fmt(symX - tailDir * 16)}" y2="${fmt(cy + dy)}" stroke="${T.ink}" stroke-width="1"/>`
        );
      }
      break;
    case "quick-connect-male": {
      // Flat blade with the crimp barrel behind it
      const bx = symX - (tailDir > 0 ? 20 : 0);
      parts.push(
        `<rect x="${fmt(bx + (tailDir > 0 ? 12 : 0))}" y="${fmt(cy - 5)}" width="8" height="10" ${stroke}/>`,
        `<rect x="${fmt(bx + (tailDir > 0 ? 0 : 8))}" y="${fmt(cy - 2.5)}" width="12" height="5" fill="${T.ink}"/>`
      );
      break;
    }
    case "quick-connect-female": {
      // Open receptacle sleeve
      const fx = symX - (tailDir > 0 ? 18 : 0);
      parts.push(
        `<rect x="${fmt(fx)}" y="${fmt(cy - 6)}" width="18" height="12" rx="2" ${stroke}/>`,
        `<line x1="${fmt(symX - tailDir * 18)}" y1="${fmt(cy)}" x2="${fmt(symX - tailDir * 12)}" y2="${fmt(cy)}" stroke="${T.ink}" stroke-width="1.5"/>`
      );
      break;
    }
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

function renderInlineComponent(box: NodeBox, layout: LayoutResult, resolved?: ResolvedPart): string {
  const node = box.node as InlineComponentNode;
  const cx = box.x + box.width / 2;
  const cy = box.y + box.height / 2;
  const parts: string[] = [];
  const stroke = `stroke="${T.ink}" stroke-width="1.5"`;

  // Lead stubs to the box edges so incoming wires meet the symbol
  parts.push(
    `<line x1="${fmt(box.x)}" y1="${fmt(cy)}" x2="${fmt(cx - 12)}" y2="${fmt(cy)}" ${stroke}/>`,
    `<line x1="${fmt(cx + 12)}" y1="${fmt(cy)}" x2="${fmt(box.x + box.width)}" y2="${fmt(cy)}" ${stroke}/>`
  );

  if (node.kind === "diode") {
    // Cathode band faces `cathodeTowards` (default: pointing right, away from root)
    const target = node.cathodeTowards ? layout.boxes.get(node.cathodeTowards) : undefined;
    const pointLeft = target ? target.x + target.width / 2 < cx : false;
    const dir = pointLeft ? -1 : 1;
    const tipX = cx + dir * 10;
    const baseX = cx - dir * 10;
    parts.push(
      `<path d="M ${fmt(baseX)} ${fmt(cy - 9)} L ${fmt(baseX)} ${fmt(cy + 9)} L ${fmt(tipX)} ${fmt(cy)} Z" fill="${T.paper}" ${stroke}/>`,
      `<line x1="${fmt(tipX)}" y1="${fmt(cy - 9)}" x2="${fmt(tipX)}" y2="${fmt(cy + 9)}" stroke="${T.ink}" stroke-width="2"/>`
    );
  } else {
    // Zigzag resistor
    const w = 24;
    const x0 = cx - w / 2;
    const step = w / 6;
    let d = `M ${fmt(x0)} ${fmt(cy)}`;
    for (let i = 0; i < 6; i++) {
      const px = x0 + step * (i + 0.5);
      const py = cy + (i % 2 === 0 ? -8 : 8);
      d += ` L ${fmt(px)} ${fmt(py)}`;
    }
    d += ` L ${fmt(x0 + w)} ${fmt(cy)}`;
    parts.push(`<path d="${d}" fill="none" ${stroke} stroke-linejoin="round"/>`);
  }

  const desc = resolved?.mpn ?? node.kind.toUpperCase();
  parts.push(text(cx, box.y - 6, `${node.id} · ${desc}`, { size: 8.5, weight: "bold", anchor: "middle" }));
  return parts.join("\n");
}

function resolvedFor(node: { part?: { vendor: string; number: string } }, parts: PartsCache): ResolvedPart | undefined {
  if (!node.part) return undefined;
  return parts[partKey(node.part as Parameters<typeof partKey>[0])];
}

/**
 * Parts gallery: framed pictorial views in a dedicated panel, so raster
 * photos never sit on top of the vector schematic.
 */
function renderPartsGallery(
  harness: Harness,
  partsCache: PartsCache,
  x: number,
  y: number,
  maxW: number
): { svg: string; height: number } {
  interface Entry {
    resolved: ResolvedPart;
    users: string[];
  }
  const entries = new Map<string, Entry>();
  const add = (ref: { vendor: string; number: string } | undefined, user: string) => {
    if (!ref) return;
    const key = partKey(ref as Parameters<typeof partKey>[0]);
    const resolved = partsCache[key];
    if (!resolved?.image) return;
    const entry = entries.get(key);
    if (entry) {
      if (!entry.users.includes(user)) entry.users.push(user);
    } else {
      entries.set(key, { resolved, users: [user] });
    }
  };
  for (const node of harness.nodes) {
    if (node.kind === "connector") {
      add(node.part, node.id);
      add(node.contacts, node.id);
      for (const hw of node.hardware ?? []) add(hw, node.id);
    } else if (node.kind === "terminal" || node.kind === "splice" || node.kind === "diode" || node.kind === "resistor") {
      add(node.part, node.id);
    }
  }
  for (const acc of harness.accessories ?? []) add(acc.part, "ACC");

  if (entries.size === 0) return { svg: "", height: 0 };

  const cardW = 74;
  const cardH = 92;
  const gap = 10;
  const perRow = Math.max(1, Math.floor((maxW + gap) / (cardW + gap)));
  const parts: string[] = [];
  let i = 0;
  for (const { resolved, users } of entries.values()) {
    const cx = x + (i % perRow) * (cardW + gap);
    const cy = y + Math.floor(i / perRow) * (cardH + gap);
    parts.push(
      `<rect x="${fmt(cx)}" y="${fmt(cy)}" width="${cardW}" height="${cardH}" fill="${T.paper}" stroke="${T.cardStroke}" stroke-width="0.75"/>`,
      `<image x="${fmt(cx + 9)}" y="${fmt(cy + 5)}" width="56" height="56" href="${resolved.image}" preserveAspectRatio="xMidYMid meet"/>`,
      text(cx + cardW / 2, cy + 72, fitText(users.join(" "), cardW - 4, 8), {
        size: 8,
        weight: "bold",
        anchor: "middle",
      }),
      text(cx + cardW / 2, cy + 84, fitText(resolved.mpn, cardW - 4, 6.5), {
        size: 6.5,
        anchor: "middle",
        fill: T.textSoft,
      })
    );
    i++;
  }
  const rows = Math.ceil(i / perRow);
  return { svg: parts.join("\n"), height: rows * (cardH + gap) };
}

/**
 * Assembly detail card for a connector: the product photo plus an authored
 * face view of the real pin pattern, each cavity filled in its wire color,
 * with an arrow showing which way the wires bend in that view's frame — the
 * references an operator needs to orient the part in hand.
 */
function renderFaceDetails(
  harness: Harness,
  partsCache: PartsCache,
  x: number,
  y: number,
  maxW: number
): { svg: string; height: number } {
  const detailed = harness.nodes.filter(
    (n): n is ConnectorNode => n.kind === "connector" && n.face !== undefined
  );
  if (detailed.length === 0) return { svg: "", height: 0 };

  const cardH = 150;
  const gap = 10;
  const parts: string[] = [];
  let cx = x;
  let cy = y;

  const wireAt = (nodeId: string, pinId: string) =>
    harness.wires.find((w) => w.from === `${nodeId}.${pinId}` || w.to === `${nodeId}.${pinId}`);

  for (const node of detailed) {
    const face = node.face!;
    const resolved = resolvedFor(node, partsCache);
    const hasPhoto = Boolean(resolved?.image);
    const faceSlot = 150;
    const cardW = 16 + (hasPhoto ? 74 : 0) + faceSlot;
    if (cx > x && cx + cardW > x + maxW) {
      cx = x;
      cy += cardH + gap;
    }

    parts.push(
      `<rect x="${fmt(cx)}" y="${fmt(cy)}" width="${cardW}" height="${cardH}" fill="${T.paper}" stroke="${T.cardStroke}" stroke-width="0.75"/>`
    );
    parts.push(text(cx + 6, cy + 13, `ASSEMBLY DETAIL — ${node.id}`, { size: 8, weight: "bold" }));

    // Caption states the requirement in words; the diagram shows it
    if (face.wireBend) {
      parts.push(
        text(cx + 6, cy + 24, fitText(`WIRES BEND ${face.wireBend.toUpperCase()} IN THIS VIEW`, cardW - 12, 5.5), {
          size: 5.5,
          fill: T.textSoft,
        })
      );
    }

    let px0 = cx + 8;

    // Product photo panel: the real part the assembler orients against
    if (resolved?.image) {
      parts.push(
        `<rect x="${fmt(px0)}" y="${fmt(cy + 30)}" width="64" height="78" fill="${T.paper}" stroke="${T.cardStroke}" stroke-width="0.75"/>`,
        `<image x="${fmt(px0 + 4)}" y="${fmt(cy + 34)}" width="56" height="56" href="${resolved.image}" preserveAspectRatio="xMidYMid meet"/>`,
        text(px0 + 32, cy + 102, fitText(resolved.mpn, 60, 6), { size: 6, anchor: "middle", fill: T.textSoft })
      );
      px0 += 74;
    }

    // Face view: the authored pin pattern (the operator's orientation
    // reference), each cavity filled with its wire color, and the bend
    // direction drawn in this view's frame
    {
      const bend = face.wireBend;
      const minX = Math.min(...face.pins.map((p) => p.x));
      const maxX = Math.max(...face.pins.map((p) => p.x));
      const minY = Math.min(...face.pins.map((p) => p.y));
      const maxY = Math.max(...face.pins.map((p) => p.y));
      const scale = Math.min(
        60 / Math.max(maxX - minX, 1e-6),
        44 / Math.max(maxY - minY, 1e-6),
        30
      );
      const cmx = px0 + faceSlot / 2;
      const cmy = cy + 74 + (bend === "up" ? 8 : bend === "down" ? -8 : 0);
      const pos = face.pins.map((fp) => ({
        fp,
        r: 5.5 * (fp.size ?? 1),
        px: cmx + (fp.x - (minX + maxX) / 2) * scale,
        py: cmy - (fp.y - (minY + maxY) / 2) * scale,
      }));

      // Connector body outline around the pin pattern
      const fbx0 = Math.min(...pos.map((m) => m.px - m.r)) - 8;
      const fbx1 = Math.max(...pos.map((m) => m.px + m.r)) + 8;
      const fby0 = Math.min(...pos.map((m) => m.py - m.r)) - 8;
      const fby1 = Math.max(...pos.map((m) => m.py + m.r)) + 8;
      parts.push(
        `<rect x="${fmt(fbx0)}" y="${fmt(fby0)}" width="${fmt(fbx1 - fbx0)}" height="${fmt(fby1 - fby0)}" rx="4" fill="${T.panelSoft}" stroke="${T.ink}" stroke-width="1"/>`
      );

      for (const { fp, r, px, py } of pos) {
        const wire = wireAt(node.id, fp.pin);
        const color = wire ? parseWireColor(wire.color) : undefined;
        const fill = color ? color.base : T.panel;
        const stroke = color && T.outlinedWires.includes(color.base) ? T.wireOutline : T.ink;
        parts.push(
          `<circle cx="${fmt(px)}" cy="${fmt(py)}" r="${fmt(r)}" fill="${fill}" stroke="${stroke}" stroke-width="1"/>`
        );
        if (color?.stripe) {
          parts.push(
            `<line x1="${fmt(px - r * 0.62)}" y1="${fmt(py)}" x2="${fmt(px + r * 0.62)}" y2="${fmt(py)}" stroke="${color.stripe}" stroke-width="${fmt(Math.max(1.8, r * 0.34))}"/>`
          );
        }
        parts.push(text(px, py + r + 7, fp.pin, { size: 5, anchor: "middle" }));
      }

      // Bend arrow: bold, outside the body, in this view's frame
      if (bend) {
        const bmx = (fbx0 + fbx1) / 2;
        const bmy = (fby0 + fby1) / 2;
        const dirs = {
          up: { x0: bmx, y0: fby0 - 4, dx: 0, dy: -1 },
          down: { x0: bmx, y0: fby1 + 4, dx: 0, dy: 1 },
          left: { x0: fbx0 - 4, y0: bmy, dx: -1, dy: 0 },
          right: { x0: fbx1 + 4, y0: bmy, dx: 1, dy: 0 },
        } as const;
        const d = dirs[bend];
        const ex = d.x0 + d.dx * 16;
        const ey = d.y0 + d.dy * 16;
        parts.push(
          `<line x1="${fmt(d.x0)}" y1="${fmt(d.y0)}" x2="${fmt(ex)}" y2="${fmt(ey)}" stroke="${T.cableJacket}" stroke-width="4" stroke-linecap="round"/>`,
          `<polygon points="${fmt(ex + d.dx * 8)},${fmt(ey + d.dy * 8)} ${fmt(ex - d.dy * 5)},${fmt(ey + d.dx * 5)} ${fmt(ex + d.dy * 5)},${fmt(ey - d.dx * 5)}" fill="${T.cableJacket}"/>`
        );
        if (bend === "up" || bend === "down") {
          parts.push(text(bmx + 9, (d.y0 + ey) / 2 + 2, "WIRE BEND", { size: 5, fill: T.textSoft }));
        } else {
          parts.push(text((d.x0 + ex) / 2, bmy - 9, "WIRE BEND", { size: 5, anchor: "middle", fill: T.textSoft }));
        }
      }

      parts.push(
        text(cmx, cy + cardH - 18, `VIEW FROM ${face.view === "mating-side" ? "MATING SIDE" : "WIRE SIDE"}`, {
          size: 5,
          anchor: "middle",
          fill: T.textDim,
        })
      );
    }

    if (face.note) {
      parts.push(
        text(cx + cardW / 2, cy + cardH - 7, fitText(face.note, cardW - 10, 5.5), {
          size: 5.5,
          anchor: "middle",
          fill: T.textSoft,
        })
      );
    }

    cx += cardW + gap;
  }

  return { svg: parts.join("\n"), height: cy - y + cardH + gap };
}

function renderNode(box: NodeBox, layout: LayoutResult, partsCache: PartsCache): string {
  const node = box.node;
  const parts: string[] = [];
  if (node.kind === "connector") {
    const resolved = resolvedFor(node, partsCache);
    const pinCellW = 24;
    const pinCellX = box.facesRight ? box.x + box.width - pinCellW : box.x;
    const pinsTop = box.y + CONNECTOR_HEADER;

    // Fills first, then each divider once, then the outer border
    parts.push(`<rect x="${fmt(box.x)}" y="${fmt(box.y)}" width="${box.width}" height="${box.height}" fill="${T.paper}"/>`);
    parts.push(
      `<rect x="${fmt(box.x)}" y="${fmt(box.y)}" width="${box.width}" height="${CONNECTOR_HEADER}" fill="${T.panel}"/>`
    );
    parts.push(
      `<rect x="${fmt(pinCellX)}" y="${fmt(pinsTop)}" width="${pinCellW}" height="${fmt(box.height - CONNECTOR_HEADER)}" fill="${T.panelSoft}"/>`
    );
    parts.push(gridLine(box.x, pinsTop, box.x + box.width, pinsTop));
    node.pins.forEach((_, i) => {
      if (i > 0) {
        const rowY = pinsTop + i * PIN_ROW;
        parts.push(gridLine(box.x, rowY, box.x + box.width, rowY));
      }
    });
    const cellDividerX = box.facesRight ? pinCellX : pinCellX + pinCellW;
    parts.push(gridLine(cellDividerX, pinsTop, cellDividerX, box.y + box.height));
    parts.push(
      `<rect x="${fmt(box.x)}" y="${fmt(box.y)}" width="${box.width}" height="${box.height}" fill="none" stroke="${T.ink}" stroke-width="${BORDER_W}"/>`
    );

    parts.push(text(box.x + 6, box.y + 14, node.id, { size: 11, weight: "bold" }));
    const sub = resolved?.mpn ?? `${node.part.vendor.toUpperCase()} ${node.part.number}`;
    parts.push(text(box.x + 6, box.y + 27, sub, { size: 8, fill: T.textMuted }));
    node.pins.forEach((pin, i) => {
      const rowY = pinsTop + i * PIN_ROW;
      parts.push(text(pinCellX + pinCellW / 2, rowY + 12.5, pin.id, { size: 9, weight: "bold", anchor: "middle" }));
      if (pin.label) {
        const labelX = box.facesRight ? box.x + 6 : box.x + pinCellW + 6;
        parts.push(text(labelX, rowY + 12.5, pin.label, { size: 8.5 }));
      }
    });
  } else if (node.kind === "terminal") {
    const resolved = resolvedFor(node, partsCache);
    parts.push(renderTerminalSymbol(box, resolved));
  } else if (node.kind === "splice") {
    const cx = box.x + box.width / 2;
    const cy = box.y + box.height / 2;
    parts.push(`<circle cx="${fmt(cx)}" cy="${fmt(cy)}" r="6" fill="${T.ink}"/>`);
    const label = node.method ? `${node.id} (${node.method.toUpperCase()})` : node.id;
    parts.push(text(cx, box.y - 4, label, { size: 8.5, weight: "bold", anchor: "middle" }));
  } else if (node.kind === "diode" || node.kind === "resistor") {
    const resolved = resolvedFor(node, partsCache);
    parts.push(renderInlineComponent(box, layout, resolved));
  } else {
    const cx = box.x + box.width / 2;
    const cy = box.y + box.height / 2;
    parts.push(`<circle cx="${fmt(cx)}" cy="${fmt(cy)}" r="4.5" fill="${T.textMuted}"/>`);
    parts.push(text(cx, box.y - 4, node.id, { size: 8, anchor: "middle", fill: T.textSoft }));
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
    const len = Math.hypot(dx, dy) || 1;
    const angle = (Math.atan2(dy, dx) * 180) / Math.PI;
    const bandH = Math.max(12, line.wires.length * 4 + 8);
    const covered = segment.covering && segment.covering !== "none";

    // Bare bundle runs show the wires alone; a band is only drawn for coverings
    if (covered) {
      let bandFill = T.band;
      if (segment.covering === "heatshrink") bandFill = T.bandHeatshrink;
      else if (segment.covering === "pet-braid") bandFill = "url(#petBraid)";
      else if (segment.covering === "spiral-wrap") bandFill = "url(#spiralWrap)";
      else if (segment.covering === "split-loom") bandFill = T.bandLoom;
      parts.push(
        `<g transform="translate(${fmt(from.x)} ${fmt(from.y)}) rotate(${fmt(angle)})">` +
          `<rect x="0" y="${fmt(-bandH / 2)}" width="${fmt(len)}" height="${bandH}" fill="${bandFill}"/>` +
          `<rect x="0" y="${fmt(-bandH / 2)}" width="${fmt(len)}" height="${bandH}" fill="none" stroke="${T.bandStroke}" stroke-width="1"${segment.covering === "split-loom" ? ` stroke-dasharray="6 3"` : ""}/>` +
          `</g>`
      );
    }

  }
  return parts.join("\n");
}

/** Segment callouts, drawn above the wires and offset perpendicular to the run. */
function renderSegmentLabels(layout: LayoutResult): string {
  const parts: string[] = [];
  for (const line of layout.segmentLines.values()) {
    const { from, to, segment } = line;
    const dx = to.x - from.x;
    const dy = to.y - from.y;
    const len = Math.hypot(dx, dy) || 1;
    const bandH = Math.max(12, line.wires.length * 4 + 8);
    const covered = segment.covering && segment.covering !== "none";

    const mx = (from.x + to.x) / 2;
    const my = (from.y + to.y) / 2;
    let px = -dy / len;
    let py = dx / len;
    if (py < 0) {
      px = -px;
      py = -py;
    }
    const clear = (covered ? bandH / 2 : 4) + 12;
    const labelParts = [`${segment.id} · ${segment.lengthMm} mm`];
    if (covered) {
      labelParts.push(COVERING_LABELS[segment.covering!] ?? segment.covering!.toUpperCase());
    }
    parts.push(
      haloText(mx + px * clear, my + py * clear + 3, labelParts[0], { size: 8.5, anchor: "middle", fill: T.textMuted })
    );
    if (labelParts[1]) {
      parts.push(
        haloText(mx + px * (clear + 10), my + py * (clear + 10) + 3, labelParts[1], {
          size: 7.5,
          anchor: "middle",
          fill: T.textDim,
        })
      );
    }
  }
  return parts.join("\n");
}

// ---------------------------------------------------------------------------
// Wire path geometry — wires are single continuous vector paths. Twisted
// groups weave as crossing strands along the run itself; corners are filleted.
// ---------------------------------------------------------------------------

interface PathPiece {
  kind: "line" | "wave";
  from: Point;
  to: Point;
  /** wave only: 0 starts up, 1 starts down */
  phase: number;
}

/** Weave between two points: alternating quadratic half-waves that end exactly at `to`. */
function waveCommands(from: Point, to: Point, phase: number): string {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const len = Math.hypot(dx, dy);
  if (len < 4) return ` L ${fmt(to.x)} ${fmt(to.y)}`;
  const halfWave = 9;
  const n = Math.max(2, Math.round(len / halfWave));
  const ux = dx / len;
  const uy = dy / len;
  const px = -uy;
  const py = ux;
  const amp = 4;
  let d = "";
  for (let k = 0; k < n; k++) {
    const t0 = k / n;
    const t1 = (k + 1) / n;
    const midT = (t0 + t1) / 2;
    const sign = (k + phase) % 2 === 0 ? 1 : -1;
    const cxp = from.x + dx * midT + px * amp * 2 * sign;
    const cyp = from.y + dy * midT + py * amp * 2 * sign;
    const ex = from.x + dx * t1;
    const ey = from.y + dy * t1;
    d += ` Q ${fmt(cxp)} ${fmt(cyp)} ${fmt(ex)} ${fmt(ey)}`;
  }
  return d;
}

/** Assemble pieces into one path, filleting corners where two straight lines meet. */
function buildWireD(pieces: PathPiece[], radius = 7): string {
  if (pieces.length === 0) return "";
  let d = `M ${fmt(pieces[0].from.x)} ${fmt(pieces[0].from.y)}`;
  for (let i = 0; i < pieces.length; i++) {
    const piece = pieces[i];
    if (piece.kind === "wave") {
      d += waveCommands(piece.from, piece.to, piece.phase);
      continue;
    }
    const next = pieces[i + 1];
    const filletNext =
      next && next.kind === "line" && next.from.x === piece.to.x && next.from.y === piece.to.y;
    if (!filletNext) {
      d += ` L ${fmt(piece.to.x)} ${fmt(piece.to.y)}`;
      continue;
    }
    // Shorten this line and start the next with a quadratic through the corner
    const len1 = Math.hypot(piece.to.x - piece.from.x, piece.to.y - piece.from.y);
    const len2 = Math.hypot(next.to.x - next.from.x, next.to.y - next.from.y);
    const r = Math.min(radius, len1 / 2, len2 / 2);
    if (r < 0.5) {
      d += ` L ${fmt(piece.to.x)} ${fmt(piece.to.y)}`;
      continue;
    }
    const inX = piece.to.x - ((piece.to.x - piece.from.x) / len1) * r;
    const inY = piece.to.y - ((piece.to.y - piece.from.y) / len1) * r;
    const outX = piece.to.x + ((next.to.x - next.from.x) / len2) * r;
    const outY = piece.to.y + ((next.to.y - next.from.y) / len2) * r;
    d += ` L ${fmt(inX)} ${fmt(inY)} Q ${fmt(piece.to.x)} ${fmt(piece.to.y)} ${fmt(outX)} ${fmt(outY)}`;
    // Rewrite the next piece to start after the fillet
    pieces[i + 1] = { ...next, from: { x: outX, y: outY } };
  }
  return d;
}

interface GroupRun {
  group: NonNullable<Harness["wireGroups"]>[number];
  label: string;
  /** segment id -> weave axis (mean of the member wires' entry/exit points) */
  axes: Map<string, { start: Point; end: Point }>;
  /** segments carrying only this group's wires — where a cable jacket may be drawn */
  pure: Set<string>;
  /** wire id -> strand index within the group */
  strand: Map<string, number>;
}

/**
 * For every twisted group (including twisted cables), compute the shared
 * segments and the centerline axis the strands weave around.
 */
function computeGroupRuns(harness: Harness, layout: LayoutResult): GroupRun[] {
  const runs: GroupRun[] = [];
  (harness.wireGroups ?? []).forEach((group, i) => {
    const paths = group.wires.map((w) => layout.wirePaths.get(w)).filter((p) => p !== undefined);
    if (paths.length !== group.wires.length || paths.length < 2) return;
    const shared = paths[0]!.routeSegments.filter((segId) =>
      paths.every((p) => p!.routeSegments.includes(segId))
    );
    if (shared.length === 0) return;
    const axes = new Map<string, { start: Point; end: Point }>();
    for (const segId of shared) {
      const ends = paths.map((p) => {
        const idx = p!.routeSegments.indexOf(segId);
        return { a: p!.points[p!.leadIn + 2 * idx], b: p!.points[p!.leadIn + 1 + 2 * idx] };
      });
      // Orient every wire's traversal the same way as the first one
      const ref = ends[0];
      let sx = 0;
      let sy = 0;
      let ex = 0;
      let ey = 0;
      for (const { a, b } of ends) {
        const straight = Math.hypot(a.x - ref.a.x, a.y - ref.a.y) <= Math.hypot(b.x - ref.a.x, b.y - ref.a.y);
        const s = straight ? a : b;
        const e = straight ? b : a;
        sx += s.x;
        sy += s.y;
        ex += e.x;
        ey += e.y;
      }
      axes.set(segId, {
        start: { x: sx / ends.length, y: sy / ends.length },
        end: { x: ex / ends.length, y: ey / ends.length },
      });
    }
    const memberSet = new Set(group.wires);
    const pure = new Set<string>();
    for (const segId of shared) {
      const line = layout.segmentLines.get(segId);
      if (line && line.wires.every((w) => memberSet.has(w))) pure.add(segId);
    }
    const strand = new Map<string, number>();
    group.wires.forEach((w, idx) => strand.set(w, idx));
    runs.push({
      group,
      label: group.label ?? group.id ?? (group.cable ? `CB${i + 1}` : `TW${i + 1}`),
      axes,
      pure,
      strand,
    });
  });
  return runs;
}

function renderWires(harness: Harness, layout: LayoutResult, groupRuns: GroupRun[]): string {
  const runByWire = new Map<string, GroupRun>();
  for (const run of groupRuns) {
    if (!run.group.twisted) continue; // non-twisted cables draw straight cores
    for (const w of run.group.wires) runByWire.set(w, run);
  }

  const parts: string[] = [];
  for (const wire of harness.wires) {
    const path = layout.wirePaths.get(wire.id);
    if (!path || path.points.length < 2) continue;
    const color = parseWireColor(wire.color);
    const fromRef = parseEndpoint(wire.from);
    const toRef = parseEndpoint(wire.to);
    let d: string;
    if (fromRef.nodeId === toRef.nodeId) {
      // Jumper (loopback): arc bulging away from the connector face
      const a = path.points[0];
      const b = path.points[path.points.length - 1];
      const box = layout.boxes.get(fromRef.nodeId);
      const bulge = box && !box.facesRight ? -22 : 22;
      const midY = (a.y + b.y) / 2;
      d = `M ${fmt(a.x)} ${fmt(a.y)} Q ${fmt(a.x + bulge)} ${fmt(midY)} ${fmt(b.x)} ${fmt(b.y)}`;
    } else {
      const run = runByWire.get(wire.id);
      const pieces: PathPiece[] = [];
      let cur = path.points[0];
      for (let p = 1; p < path.leadIn; p++) {
        pieces.push({ kind: "line", from: cur, to: path.points[p], phase: 0 });
        cur = path.points[p];
      }
      path.routeSegments.forEach((segId, i) => {
        let entry = path.points[path.leadIn + 2 * i];
        let exit = path.points[path.leadIn + 1 + 2 * i];
        const axis = run?.axes.get(segId);
        if (axis) {
          // Weave around the group centerline instead of the parallel offset
          const straight =
            Math.hypot(entry.x - axis.start.x, entry.y - axis.start.y) <=
            Math.hypot(entry.x - axis.end.x, entry.y - axis.end.y);
          entry = straight ? axis.start : axis.end;
          exit = straight ? axis.end : axis.start;
        }
        if (entry.x !== cur.x || entry.y !== cur.y) pieces.push({ kind: "line", from: cur, to: entry, phase: 0 });
        pieces.push({
          kind: axis ? "wave" : "line",
          from: entry,
          to: exit,
          phase: (run?.strand.get(wire.id) ?? 0) % 2,
        });
        cur = exit;
      });
      for (let p = path.leadIn + 2 * path.routeSegments.length; p < path.points.length; p++) {
        const pt = path.points[p];
        if (pt.x === cur.x && pt.y === cur.y) continue;
        pieces.push({ kind: "line", from: cur, to: pt, phase: 0 });
        cur = pt;
      }
      d = buildWireD(pieces);
    }
    if (T.outlinedWires.includes(color.base)) {
      parts.push(
        `<path d="${d}" fill="none" stroke="${T.wireOutline}" stroke-width="3" stroke-linejoin="round" stroke-linecap="round"/>`
      );
    }
    parts.push(
      `<path d="${d}" fill="none" stroke="${color.base}" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>`
    );
    if (color.stripe) {
      parts.push(
        `<path d="${d}" fill="none" stroke="${color.stripe}" stroke-width="2" stroke-dasharray="5 5" stroke-linejoin="round" stroke-linecap="round"/>`
      );
    }
  }
  return parts.join("\n");
}

/**
 * Multicore cable sheaths: a tube the cores run inside, drawn as layered
 * strokes along the shared run. Shielded cables show a braid/foil rim.
 */
function renderCableSheaths(harness: Harness, layout: LayoutResult, groupRuns: GroupRun[]): string {
  const parts: string[] = [];
  for (const run of groupRuns) {
    if (!run.group.cable) continue;
    const shield = run.group.shield && run.group.shield !== "none" ? run.group.shield : undefined;
    const h = Math.max(14, run.group.wires.length * 3 + 10);
    for (const [segId, { start, end }] of run.axes) {
      // Jacket only where the cable runs by itself; in mixed bundles just the cores show
      if (!run.pure.has(segId)) continue;
      const d = `M ${fmt(start.x)} ${fmt(start.y)} L ${fmt(end.x)} ${fmt(end.y)}`;
      parts.push(`<path d="${d}" fill="none" stroke="${T.cableJacket}" stroke-width="${fmt(h)}" stroke-linecap="round"/>`);
      if (shield) {
        const rim = shield === "braid" ? "url(#shieldBraid)" : "url(#shieldFoil)";
        parts.push(
          `<path d="${d}" fill="none" stroke="${rim}" stroke-width="${fmt(h - 2.5)}" stroke-linecap="round"/>`
        );
        parts.push(
          `<path d="${d}" fill="none" stroke="${T.cableInner}" stroke-width="${fmt(h - 7.5)}" stroke-linecap="round"/>`
        );
      } else {
        parts.push(
          `<path d="${d}" fill="none" stroke="${T.cableInner}" stroke-width="${fmt(h - 2.5)}" stroke-linecap="round"/>`
        );
      }
    }
  }
  return parts.join("\n");
}

/** Group callouts (TW1, CB1 · FOIL SHIELD) as haloed text above the run — no patch boxes. */
function renderGroupLabels(groupRuns: GroupRun[]): string {
  const parts: string[] = [];
  for (const run of groupRuns) {
    const axes = [...run.axes.values()];
    // Longest shared run hosts the label
    const best = axes.reduce((a, b) =>
      Math.hypot(a.end.x - a.start.x, a.end.y - a.start.y) >= Math.hypot(b.end.x - b.start.x, b.end.y - b.start.y)
        ? a
        : b
    );
    const mx = (best.start.x + best.end.x) / 2;
    const my = (best.start.y + best.end.y) / 2;
    const dx = best.end.x - best.start.x;
    const dy = best.end.y - best.start.y;
    const len = Math.hypot(dx, dy) || 1;
    // Perpendicular pointing up-ish so the label sits above the run
    let px = -dy / len;
    let py = dx / len;
    if (py > 0) {
      px = -px;
      py = -py;
    }
    const h = run.group.cable ? Math.max(14, run.group.wires.length * 3 + 10) : 10;
    const offset = h / 2 + 12;
    const shield = run.group.shield && run.group.shield !== "none" ? run.group.shield : undefined;
    const label = shield ? `${run.label} · ${shield.toUpperCase()} SHIELD` : run.label;
    parts.push(
      haloText(mx + px * offset, my + py * offset + 3, label, { size: 8, weight: "bold", anchor: "middle" })
    );
  }
  return parts.join("\n");
}

function renderTitleBlock(x: number, y: number, w: number, h: number, harness: Harness, sheet: SheetSize): string {
  const meta = harness.meta;
  const parts: string[] = [];
  const row1 = h * 0.42;
  const row2 = (h - row1) / 2;
  const c1 = w * 0.42;
  const c2 = w * 0.18;
  const c3 = w * 0.2;
  const c4 = w - c1 - c2 - c3;

  // Fill, then each divider exactly once, then the outer border
  parts.push(`<rect x="${fmt(x)}" y="${fmt(y)}" width="${w}" height="${h}" fill="${T.paper}"/>`);
  parts.push(gridLine(x, y + row1, x + w, y + row1));
  parts.push(gridLine(x, y + row1 + row2, x + w, y + row1 + row2));
  parts.push(gridLine(x + c1, y + row1, x + c1, y + h));
  parts.push(gridLine(x + c1 + c2, y + row1, x + c1 + c2, y + row1 + row2));
  parts.push(gridLine(x + c1 + c2 + c3, y + row1, x + c1 + c2 + c3, y + h));
  parts.push(
    `<rect x="${fmt(x)}" y="${fmt(y)}" width="${w}" height="${h}" fill="none" stroke="${T.ink}" stroke-width="${BORDER_W}"/>`
  );

  const field = (fx: number, fy: number, fh: number, caption: string, value: string, valueSize = 10) => {
    parts.push(text(fx + 4, fy + 9, caption, { size: 6, fill: T.textDim }));
    parts.push(text(fx + 4, fy + fh - 5, value, { size: valueSize, weight: "bold" }));
  };

  field(x, y, row1, "TITLE", meta.title, 13);
  field(x, y + row1, row2, "PART NUMBER", meta.partNumber ?? "—");
  field(x + c1, y + row1, row2, "REV", meta.rev ?? "—");
  field(x + c1 + c2, y + row1, row2, "DATE", meta.date ?? "—");
  field(x + c1 + c2 + c3, y + row1, row2, "SCALE", "NTS");
  field(x, y + row1 + row2, row2, "COMPANY", meta.company ?? "—");
  field(x + c1, y + row1 + row2, row2, "DRAWN BY", meta.drawnBy ?? "—");
  field(x + c1 + c2 + c3, y + row1 + row2, row2, "SHEET", sheet);
  return parts.join("\n");
}

export interface RenderResult {
  svg: string;
  width: number;
  height: number;
}

export function renderHarnessSvg(harness: Harness, options: RenderOptions = {}): RenderResult {
  T = THEMES[options.theme ?? "light"];
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
      `<rect width="7" height="7" fill="${T.patternBg}"/>` +
      `<path d="M 0 7 L 7 0 M 0 0 L 7 7" stroke="${T.patternFg}" stroke-width="0.8"/>` +
      `</pattern>` +
      `<pattern id="spiralWrap" width="8" height="8" patternUnits="userSpaceOnUse">` +
      `<rect width="8" height="8" fill="${T.patternBg}"/>` +
      `<path d="M 0 8 L 8 0" stroke="${T.patternFg}" stroke-width="1.5"/>` +
      `</pattern>` +
      `<pattern id="shieldBraid" width="6" height="6" patternUnits="userSpaceOnUse">` +
      `<rect width="6" height="6" fill="${T.shieldBraidBg}"/>` +
      `<path d="M 0 6 L 6 0 M 0 0 L 6 6" stroke="${T.shieldBraidFg}" stroke-width="0.7"/>` +
      `</pattern>` +
      `<pattern id="shieldFoil" width="8" height="8" patternUnits="userSpaceOnUse">` +
      `<rect width="8" height="8" fill="${T.shieldFoilBg}"/>` +
      `<path d="M 0 8 L 8 0" stroke="${T.shieldFoilFg}" stroke-width="0.7"/>` +
      `</pattern>` +
      `</defs>`
  );
  parts.push(`<rect x="0" y="0" width="${W}" height="${H}" fill="${T.paper}"/>`);
  parts.push(
    `<rect x="${frame.x}" y="${frame.y}" width="${frame.w}" height="${frame.h}" fill="none" stroke="${T.ink}" stroke-width="2"/>`
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

  // Notes: between wire list and title block, word-wrapped so they never
  // spill into the title block or past the frame
  const notes = harness.notes ?? [];
  let notesH = 0;
  if (notes.length > 0) {
    const nX = wlX + wlW + 24;
    const noteSize = 9;
    const noteW = tbX - 16 - nX;
    const wrapped = notes.map((note, i) => wrapText(`${i + 1}. ${note}`, noteW, noteSize));
    const totalLines = wrapped.reduce((sum, lines) => sum + lines.length, 0);
    const nY = frame.y + frame.h - 10 - totalLines * 13 - 16;
    notesH = frame.y + frame.h - nY;
    parts.push(text(nX, nY, "NOTES:", { size: 10, weight: "bold" }));
    let lineIdx = 0;
    for (const lines of wrapped) {
      lines.forEach((line, j) => {
        parts.push(text(nX + (j > 0 ? 12 : 0), nY + 15 + lineIdx * 13, line, { size: noteSize }));
        lineIdx++;
      });
    }
  }

  // Parts gallery: pictorial views in the top-left, clear of the schematic
  const gallery = renderPartsGallery(
    harness,
    partsCache,
    frame.x + 10,
    frame.y + 10,
    bomX - frame.x - 40
  );
  parts.push(gallery.svg);

  // Assembly details: connector face views below the gallery
  const faceDetails = renderFaceDetails(
    harness,
    partsCache,
    frame.x + 10,
    frame.y + 10 + gallery.height,
    bomX - frame.x - 40
  );
  parts.push(faceDetails.svg);
  const topBand = gallery.height + faceDetails.height;

  // Drawing area: center on the sheet (below the gallery, above the bottom
  // band); if the drawing would collide with the BOM in the top-right, fall
  // back to the region left of it.
  const bottomBand = Math.max(wlH, tbH, notesH) + 24;
  const b = { ...layout.bounds };
  const pad = 30;
  const availY = frame.y + 20 + topBand;
  const availH = frame.h - bottomBand - 40 - topBand;
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

  const groupRuns = computeGroupRuns(harness, layout);
  parts.push(`<g transform="translate(${fmt(tx)} ${fmt(ty)}) scale(${fmt(scale)})">`);
  parts.push(renderSegments(layout));
  parts.push(renderCableSheaths(harness, layout, groupRuns));
  parts.push(renderWires(harness, layout, groupRuns));
  parts.push(renderSegmentLabels(layout));
  parts.push(renderGroupLabels(groupRuns));
  for (const box of layout.boxes.values()) parts.push(renderNode(box, layout, partsCache));
  parts.push(`</g>`);

  parts.push(
    text(frame.x + 4, H - 6, "Generated by almond-harness-studio", { size: 7, fill: T.textFaint })
  );
  parts.push(`</svg>`);

  return { svg: parts.join("\n"), width: W, height: H };
}
