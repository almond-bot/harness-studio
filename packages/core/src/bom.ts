import type { Harness, PartRef, PartsCache, TerminalNode } from "./types.js";
import { partKey } from "./types.js";
import { parseWireColor } from "./colors.js";
import { resolveRoute } from "./layout.js";

export interface BomRow {
  item: number;
  qty: string;
  /** Manufacturer part number (from the distributor record) */
  mpn: string;
  description: string;
  /** e.g. "LCSC C30170181" — empty for wire/coverings */
  source: string;
}

export interface WireListRow {
  wire: string;
  from: string;
  to: string;
  gauge: string;
  color: string;
  lengthMm: number;
  notes: string;
}

const VENDOR_NAMES: Record<string, string> = {
  lcsc: "LCSC",
  mouser: "MOUSER",
  digikey: "DIGI-KEY",
};

export function formatSource(ref: PartRef): string {
  return `${VENDOR_NAMES[ref.vendor] ?? ref.vendor.toUpperCase()} ${ref.number}`;
}

const TERMINAL_STYLE_NAMES: Record<TerminalNode["style"], string> = {
  ring: "RING TERMINAL",
  spade: "SPADE TERMINAL",
  ferrule: "FERRULE",
  tinned: "TINNED LEAD",
  bare: "BARE WIRE",
  "solder-cup": "SOLDER CUP",
  pin: "PIN TERMINAL",
};

export function wireLengthMm(harness: Harness, wireId: string): number {
  const segById = new Map(harness.segments.map((s) => [s.id, s]));
  return resolveRoute(harness, wireId).reduce((sum, id) => sum + (segById.get(id)?.lengthMm ?? 0), 0);
}

export function buildWireList(harness: Harness): WireListRow[] {
  const twistNotes = new Map<string, string>();
  (harness.wireGroups ?? []).forEach((group, i) => {
    if (!group.twisted) return;
    const label = group.label ?? group.id ?? `TW${i + 1}`;
    for (const w of group.wires) twistNotes.set(w, `TWISTED (${label})`);
  });

  return harness.wires.map((wire) => ({
    wire: wire.label ?? wire.id,
    from: wire.from,
    to: wire.to,
    gauge: wire.gauge ?? "—",
    color: parseWireColor(wire.color).code,
    lengthMm: wireLengthMm(harness, wire.id),
    notes: [twistNotes.get(wire.id), wire.notes].filter(Boolean).join("; "),
  }));
}

const COVERING_NAMES: Record<string, string> = {
  heatshrink: "HEATSHRINK TUBING",
  "pet-braid": "PET BRAIDED SLEEVING",
  "split-loom": "SPLIT LOOM",
  "spiral-wrap": "SPIRAL WRAP",
};

/** Every sourced part referenced by the harness, in stable order. */
export function collectPartRefs(harness: Harness): PartRef[] {
  const refs: PartRef[] = [];
  const seen = new Set<string>();
  const add = (ref?: PartRef) => {
    if (!ref) return;
    const key = partKey(ref);
    if (seen.has(key)) return;
    seen.add(key);
    refs.push(ref);
  };
  for (const node of harness.nodes) {
    if (node.kind === "connector") add(node.part);
    else if (node.kind === "terminal" || node.kind === "splice") add(node.part);
  }
  for (const acc of harness.accessories ?? []) add(acc.part);
  return refs;
}

export function buildBom(harness: Harness, parts: PartsCache = {}): BomRow[] {
  const rows: Omit<BomRow, "item">[] = [];

  const describe = (ref: PartRef, fallback: string): { mpn: string; description: string } => {
    const resolved = parts[partKey(ref)];
    if (!resolved) return { mpn: ref.number, description: fallback };
    return {
      mpn: resolved.mpn || ref.number,
      description: (resolved.description || fallback).toUpperCase(),
    };
  };

  // Sourced parts grouped by vendor part, counted per use
  const partCounts = new Map<string, { qty: number; ref: PartRef; fallback: string }>();
  const addPart = (ref: PartRef, fallback: string) => {
    const key = partKey(ref);
    const existing = partCounts.get(key);
    if (existing) existing.qty += 1;
    else partCounts.set(key, { qty: 1, ref, fallback });
  };

  for (const node of harness.nodes) {
    if (node.kind === "connector") {
      addPart(node.part, `CONNECTOR, ${node.pins.length} POS`);
    } else if (node.kind === "terminal") {
      const fallback = node.stud
        ? `${TERMINAL_STYLE_NAMES[node.style]}, ${node.stud} STUD`
        : TERMINAL_STYLE_NAMES[node.style];
      if (node.part) addPart(node.part, fallback);
    } else if (node.kind === "splice" && node.part) {
      addPart(node.part, `SPLICE${node.method ? `, ${node.method.toUpperCase()}` : ""}`);
    }
  }
  for (const { qty, ref, fallback } of partCounts.values()) {
    const { mpn, description } = describe(ref, fallback);
    rows.push({ qty: String(qty), mpn, description, source: formatSource(ref) });
  }

  // Wire grouped by gauge + color, quantity = total length
  const wireTotals = new Map<string, { lengthMm: number; gauge: string; color: string }>();
  for (const wire of harness.wires) {
    const gauge = wire.gauge ?? "—";
    const color = parseWireColor(wire.color).code;
    const key = `${gauge}|${color}`;
    const total = wireTotals.get(key) ?? { lengthMm: 0, gauge, color };
    total.lengthMm += wireLengthMm(harness, wire.id);
    wireTotals.set(key, total);
  }
  for (const total of wireTotals.values()) {
    rows.push({
      qty: `${total.lengthMm} mm`,
      mpn: "—",
      description: `WIRE, ${total.gauge}, ${total.color}`.toUpperCase(),
      source: "",
    });
  }

  // Coverings grouped by type, quantity = total covered length
  const coverTotals = new Map<string, number>();
  for (const seg of harness.segments) {
    if (seg.covering && seg.covering !== "none") {
      coverTotals.set(seg.covering, (coverTotals.get(seg.covering) ?? 0) + seg.lengthMm);
    }
  }
  for (const [covering, lengthMm] of coverTotals) {
    rows.push({
      qty: `${lengthMm} mm`,
      mpn: "—",
      description: COVERING_NAMES[covering] ?? covering.toUpperCase(),
      source: "",
    });
  }

  for (const acc of harness.accessories ?? []) {
    const { mpn, description } = describe(acc.part, "ACCESSORY");
    rows.push({
      qty: String(acc.qty),
      mpn,
      description: acc.notes ? `${description} — ${acc.notes.toUpperCase()}` : description,
      source: formatSource(acc.part),
    });
  }

  return rows.map((row, i) => ({ item: i + 1, ...row }));
}
