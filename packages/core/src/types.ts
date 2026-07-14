export type SheetSize = "ANSI B" | "Letter" | "A4" | "A3";

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
  mpn?: string;
  description?: string;
  pins: Pin[];
  position?: Position;
}

export type TerminalStyle = "ring" | "spade" | "ferrule" | "tinned" | "bare" | "solder-cup" | "pin";

export interface TerminalNode {
  id: string;
  kind: "terminal";
  style: TerminalStyle;
  /** Stud size for ring/spade terminals, e.g. "M4" or "#10" */
  stud?: string;
  mpn?: string;
  description?: string;
  position?: Position;
}

export type SpliceMethod = "crimp" | "solder" | "ultrasonic";

export interface SpliceNode {
  id: string;
  kind: "splice";
  method?: SpliceMethod;
  description?: string;
  position?: Position;
}

export interface BreakoutNode {
  id: string;
  kind: "breakout";
  position?: Position;
}

export type HarnessNode = ConnectorNode | TerminalNode | SpliceNode | BreakoutNode;

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
  /** Endpoint reference: "J1.1" (node.pin) or "T1" (pinless node) */
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

export interface WireGroup {
  id?: string;
  wires: string[];
  twisted?: boolean;
  label?: string;
}

export interface Accessory {
  mpn?: string;
  description: string;
  qty: number | string;
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
