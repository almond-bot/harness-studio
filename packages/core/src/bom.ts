import type { Harness, PartRef, PartsCache, TerminalNode } from "./types.js";
import { parseEndpoint, partKey } from "./types.js";
import { parseWireColor } from "./colors.js";
import { resolveRoute } from "./layout.js";

export interface BomRow {
  item: number;
  qty: string;
  /** Manufacturer part number (from the distributor record) */
  mpn: string;
  description: string;
  manufacturer: string;
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
  "quick-connect-male": "QUICK CONNECT, MALE",
  "quick-connect-female": "QUICK CONNECT, FEMALE",
  tinned: "TINNED LEAD",
  bare: "BARE WIRE",
  "solder-cup": "SOLDER CUP",
  pin: "PIN TERMINAL",
};

export function wireLengthMm(harness: Harness, wireId: string): number {
  const segById = new Map(harness.segments.map((s) => [s.id, s]));
  return resolveRoute(harness, wireId).reduce((sum, id) => sum + (segById.get(id)?.lengthMm ?? 0), 0);
}

function isJumper(wire: { from: string; to: string }): boolean {
  return parseEndpoint(wire.from).nodeId === parseEndpoint(wire.to).nodeId;
}

export function buildWireList(harness: Harness): WireListRow[] {
  const groupNotes = new Map<string, string[]>();
  const note = (wireId: string, text: string) => {
    if (!groupNotes.has(wireId)) groupNotes.set(wireId, []);
    groupNotes.get(wireId)!.push(text);
  };
  (harness.wireGroups ?? []).forEach((group, i) => {
    const label = group.label ?? group.id ?? (group.cable ? `CB${i + 1}` : `TW${i + 1}`);
    for (const w of group.wires) {
      if (group.cable) {
        const shield = group.shield && group.shield !== "none" ? `, ${group.shield.toUpperCase()} SHIELD` : "";
        note(w, `CABLE ${label}${shield}`);
      }
      if (group.twisted) note(w, `TWISTED (${label})`);
    }
  });

  return harness.wires.map((wire) => ({
    wire: wire.label ?? wire.id,
    from: wire.from,
    to: wire.to,
    gauge: wire.gauge ?? "—",
    color: parseWireColor(wire.color).code,
    lengthMm: isJumper(wire) ? 0 : wireLengthMm(harness, wire.id),
    notes: [
      ...(isJumper(wire) ? ["JUMPER"] : []),
      ...(groupNotes.get(wire.id) ?? []),
      ...(wire.notes ? [wire.notes] : []),
    ].join("; "),
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
    if (node.kind === "connector") {
      add(node.part);
      add(node.contacts);
      for (const hw of node.hardware ?? []) add(hw);
    } else if (node.kind === "terminal" || node.kind === "splice") {
      add(node.part);
    } else if (node.kind === "diode" || node.kind === "resistor") {
      add(node.part);
    }
  }
  for (const group of harness.wireGroups ?? []) add(group.part);
  for (const acc of harness.accessories ?? []) add(acc.part);
  return refs;
}

export function buildBom(harness: Harness, parts: PartsCache = {}): BomRow[] {
  const rows: Omit<BomRow, "item">[] = [];

  const describe = (
    ref: PartRef,
    fallback: string
  ): { mpn: string; description: string; manufacturer: string } => {
    const resolved = parts[partKey(ref)];
    if (!resolved) return { mpn: ref.number, description: fallback, manufacturer: "" };
    return {
      mpn: resolved.mpn || ref.number,
      description: (resolved.description || fallback).toUpperCase(),
      manufacturer: resolved.manufacturer,
    };
  };

  // Sourced parts grouped by vendor part, counted per use
  const partCounts = new Map<string, { qty: number; ref: PartRef; fallback: string }>();
  const addPart = (ref: PartRef, fallback: string, qty = 1) => {
    const key = partKey(ref);
    const existing = partCounts.get(key);
    if (existing) existing.qty += qty;
    else partCounts.set(key, { qty, ref, fallback });
  };

  const wiredPinCount = (connectorId: string): number => {
    const pins = new Set<string>();
    for (const wire of harness.wires) {
      for (const end of [wire.from, wire.to]) {
        const ref = parseEndpoint(end);
        if (ref.nodeId === connectorId && ref.pinId) pins.add(ref.pinId);
      }
    }
    return pins.size;
  };

  for (const node of harness.nodes) {
    if (node.kind === "connector") {
      addPart(node.part, `CONNECTOR, ${node.pins.length} POS`);
      if (node.contacts) addPart(node.contacts, "CRIMP CONTACT", Math.max(1, wiredPinCount(node.id)));
      for (const hw of node.hardware ?? []) addPart(hw, "CONNECTOR HARDWARE");
    } else if (node.kind === "terminal") {
      const fallback = node.stud
        ? `${TERMINAL_STYLE_NAMES[node.style]}, ${node.stud} STUD`
        : TERMINAL_STYLE_NAMES[node.style];
      if (node.part) addPart(node.part, fallback);
    } else if (node.kind === "splice" && node.part) {
      addPart(node.part, `SPLICE${node.method ? `, ${node.method.toUpperCase()}` : ""}`);
    } else if (node.kind === "diode" || node.kind === "resistor") {
      addPart(node.part, node.kind.toUpperCase());
    }
  }
  for (const { qty, ref, fallback } of partCounts.values()) {
    const { mpn, description, manufacturer } = describe(ref, fallback);
    rows.push({ qty: String(qty), mpn, description, manufacturer, source: formatSource(ref) });
  }

  // Sourced multicore cables: one row per cable group, length = longest core.
  // Their core wires are excluded from the bulk wire totals below.
  const cableCoreWires = new Set<string>();
  (harness.wireGroups ?? []).forEach((group, i) => {
    if (!group.cable) return;
    for (const w of group.wires) cableCoreWires.add(w);
    const lengthMm = Math.max(...group.wires.map((w) => wireLengthMm(harness, w)), 0);
    const label = group.label ?? group.id ?? `CB${i + 1}`;
    const shield = group.shield && group.shield !== "none" ? `, ${group.shield.toUpperCase()} SHIELD` : "";
    const fallback = `CABLE ${label}, ${group.wires.length} CORE${shield}`;
    if (group.part) {
      const { mpn, description, manufacturer } = describe(group.part, fallback);
      rows.push({ qty: `${lengthMm} mm`, mpn, description, manufacturer, source: formatSource(group.part) });
    } else {
      rows.push({ qty: `${lengthMm} mm`, mpn: "—", description: fallback, manufacturer: "", source: "" });
    }
  });

  // Wire grouped by gauge + color, quantity = total length
  const wireTotals = new Map<string, { lengthMm: number; gauge: string; color: string }>();
  for (const wire of harness.wires) {
    if (cableCoreWires.has(wire.id)) continue;
    const gauge = wire.gauge ?? "—";
    const color = parseWireColor(wire.color).code;
    const key = `${gauge}|${color}`;
    const total = wireTotals.get(key) ?? { lengthMm: 0, gauge, color };
    total.lengthMm += wireLengthMm(harness, wire.id);
    wireTotals.set(key, total);
  }
  for (const total of wireTotals.values()) {
    if (total.lengthMm <= 0) continue; // jumpers consume no measured wire
    rows.push({
      qty: `${total.lengthMm} mm`,
      mpn: "—",
      description: `WIRE, ${total.gauge}, ${total.color}`.toUpperCase(),
      manufacturer: "",
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
      manufacturer: "",
      source: "",
    });
  }

  for (const acc of harness.accessories ?? []) {
    const { mpn, description, manufacturer } = describe(acc.part, "ACCESSORY");
    rows.push({
      qty: String(acc.qty),
      mpn,
      description: acc.notes ? `${description} — ${acc.notes.toUpperCase()}` : description,
      manufacturer,
      source: formatSource(acc.part),
    });
  }

  return rows.map((row, i) => ({ item: i + 1, ...row }));
}
