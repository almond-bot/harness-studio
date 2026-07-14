import type { Harness, TerminalNode } from "./types.js";
import { parseWireColor } from "./colors.js";
import { resolveRoute } from "./layout.js";

export interface BomRow {
  item: number;
  qty: string;
  mpn: string;
  description: string;
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

function terminalDescription(node: TerminalNode): string {
  const styles: Record<TerminalNode["style"], string> = {
    ring: "RING TERMINAL",
    spade: "SPADE TERMINAL",
    ferrule: "FERRULE",
    tinned: "TINNED LEAD",
    bare: "BARE WIRE",
    "solder-cup": "SOLDER CUP",
    pin: "PIN TERMINAL",
  };
  const base = node.description ?? styles[node.style];
  return node.stud ? `${base}, ${node.stud} STUD` : base;
}

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

export function buildBom(harness: Harness): BomRow[] {
  const rows: Omit<BomRow, "item">[] = [];

  // Connectors and terminals grouped by part
  const partCounts = new Map<string, { qty: number; mpn: string; description: string }>();
  const addPart = (key: string, mpn: string, description: string) => {
    const existing = partCounts.get(key);
    if (existing) existing.qty += 1;
    else partCounts.set(key, { qty: 1, mpn, description });
  };

  for (const node of harness.nodes) {
    if (node.kind === "connector") {
      const desc = node.description ?? `CONNECTOR, ${node.pins.length} POS`;
      addPart(`connector:${node.mpn ?? desc}`, node.mpn ?? "—", desc.toUpperCase());
    } else if (node.kind === "terminal") {
      const desc = terminalDescription(node);
      addPart(`terminal:${node.mpn ?? desc}`, node.mpn ?? "—", desc.toUpperCase());
    } else if (node.kind === "splice") {
      const desc = node.description ?? `SPLICE${node.method ? `, ${node.method.toUpperCase()}` : ""}`;
      addPart(`splice:${desc}`, "—", desc.toUpperCase());
    }
  }
  for (const part of partCounts.values()) {
    rows.push({ qty: String(part.qty), mpn: part.mpn, description: part.description });
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
    rows.push({ qty: `${lengthMm} mm`, mpn: "—", description: COVERING_NAMES[covering] ?? covering.toUpperCase() });
  }

  for (const acc of harness.accessories ?? []) {
    rows.push({ qty: String(acc.qty), mpn: acc.mpn ?? "—", description: acc.description.toUpperCase() });
  }

  return rows.map((row, i) => ({ item: i + 1, ...row }));
}
