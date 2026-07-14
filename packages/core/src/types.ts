export type SheetSize = "ANSI B" | "Letter" | "A4" | "A3";

export type PartVendor = "lcsc" | "mouser" | "digikey";

/**
 * Reference to a real, orderable component at a distributor. Components are
 * always sourced — there are no free-form/generic components except wire and
 * bulk coverings.
 */
export interface PartRef {
  vendor: PartVendor;
  /** Vendor part number: LCSC "C30170181", Mouser part # or MPN, Digi-Key part # */
  number: string;
}

/** Distributor data for a PartRef, fetched by the CLI and cached on disk. */
export interface ResolvedPart {
  vendor: PartVendor;
  number: string;
  mpn: string;
  manufacturer: string;
  description: string;
  datasheetUrl?: string;
  imageUrl?: string;
  /** Product photo as a data URI, embedded so drawings render offline */
  image?: string;
  productUrl?: string;
  /** Unit price in USD at quantity 1 */
  priceUsd?: number;
  stock?: number;
  fetchedAt: string;
}

/** Keyed by `${vendor}:${number}` */
export type PartsCache = Record<string, ResolvedPart>;

export function partKey(ref: PartRef): string {
  return `${ref.vendor}:${ref.number}`;
}

export interface HarnessMeta {
  title: string;
  partNumber?: string;
  rev?: string;
  date?: string;
  company?: string;
  drawnBy?: string;
  sheet?: SheetSize;
}

export interface Pin {
  id: string;
  label?: string;
}

export interface Position {
  x: number;
  y: number;
}

export interface ConnectorNode {
  id: string;
  kind: "connector";
  /** Sourced component (required — no generic connectors) */
  part: PartRef;
  pins: Pin[];
  /** Crimp contact part, applied per wired cavity (BOM qty = wired pins) */
  contacts?: PartRef;
  /** Locks, boots, backshells, dust covers — one BOM line each */
  hardware?: PartRef[];
  position?: Position;
}

export type TerminalStyle =
  | "ring"
  | "spade"
  | "ferrule"
  | "quick-connect-male"
  | "quick-connect-female"
  | "tinned"
  | "bare"
  | "solder-cup"
  | "pin";

export interface TerminalNode {
  id: string;
  kind: "terminal";
  style: TerminalStyle;
  /** Stud size for ring/spade terminals, e.g. "M4" or "#10" */
  stud?: string;
  /**
   * Sourced component. Required for real parts (ring/spade/ferrule/pin/
   * solder-cup); omitted only for wire preparations (tinned/bare ends).
   */
  part?: PartRef;
  position?: Position;
}

export type SpliceMethod = "crimp" | "solder" | "ultrasonic";

export interface SpliceNode {
  id: string;
  kind: "splice";
  method?: SpliceMethod;
  /** Optional sourced splice hardware (crimp band, butt splice, etc.) */
  part?: PartRef;
  position?: Position;
}

export interface BreakoutNode {
  id: string;
  kind: "breakout";
  position?: Position;
}

/** Inline two-lead component spliced into the harness (flyback diodes, pull resistors). */
export interface InlineComponentNode {
  id: string;
  kind: "diode" | "resistor";
  /** Sourced component (required) */
  part: PartRef;
  /** Diode only: neighbor node id the cathode band faces; defaults away from the layout root */
  cathodeTowards?: string;
  position?: Position;
}

export type HarnessNode = ConnectorNode | TerminalNode | SpliceNode | BreakoutNode | InlineComponentNode;

export type Covering = "none" | "heatshrink" | "pet-braid" | "split-loom" | "spiral-wrap";

export interface Segment {
  id: string;
  from: string;
  to: string;
  lengthMm: number;
  covering?: Covering;
}

export interface Wire {
  id: string;
  /**
   * Endpoint reference: "J1.1" (node.pin) or "T1" (pinless node).
   * A wire between two pins of the same connector is a jumper (loopback)
   * with zero length.
   */
  from: string;
  to: string;
  gauge?: string;
  /** e.g. "red" or striped "red/white" */
  color?: string;
  label?: string;
  /** Segment ids the wire runs through; auto-derived when omitted */
  route?: string[];
  notes?: string;
}

export type CableShield = "none" | "foil" | "braid";

export interface WireGroup {
  id?: string;
  wires: string[];
  twisted?: boolean;
  /** Cores of one multicore cable, drawn with a shared sheath */
  cable?: boolean;
  /**
   * Sourced cable part (cable groups). When set, the BOM lists the cable
   * (length = longest core) instead of the individual core wires.
   */
  part?: PartRef;
  /** Cable shield; connect a drain via a wire from a core to ground */
  shield?: CableShield;
  label?: string;
}

export interface Accessory {
  /** Sourced component (required — no generic accessories) */
  part: PartRef;
  qty: number | string;
  notes?: string;
}

export interface Harness {
  $schema?: string;
  meta: HarnessMeta;
  nodes: HarnessNode[];
  segments: Segment[];
  wires: Wire[];
  wireGroups?: WireGroup[];
  accessories?: Accessory[];
  notes?: string[];
  layout?: {
    /** Node id placed at the left of the drawing; defaults to the first connector */
    root?: string;
  };
  /**
   * Resolved distributor data, maintained by `parts fetch` (never hand-written).
   * Keeping it in the file makes drawings self-contained and offline-renderable.
   */
  parts?: PartsCache;
}

export interface EndpointRef {
  nodeId: string;
  pinId?: string;
}

export function parseEndpoint(ref: string): EndpointRef {
  const dot = ref.indexOf(".");
  if (dot === -1) return { nodeId: ref };
  return { nodeId: ref.slice(0, dot), pinId: ref.slice(dot + 1) };
}
