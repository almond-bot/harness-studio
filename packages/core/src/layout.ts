import type { Harness, HarnessNode, Segment } from "./types.js";
import { parseEndpoint } from "./types.js";
import { findSegmentPath } from "./graph.js";

export interface Point {
  x: number;
  y: number;
}

export interface NodeBox {
  node: HarnessNode;
  x: number;
  y: number;
  width: number;
  height: number;
  /** Absolute pin anchor points (connectors only) */
  pinAnchors: Map<string, Point>;
  /** True when pins/wire attachments face right (root side) */
  facesRight: boolean;
}

export interface SegmentLine {
  segment: Segment;
  from: Point;
  to: Point;
  /** Wire ids routed through this segment, in offset order */
  wires: string[];
}

export interface WirePath {
  wireId: string;
  points: Point[];
  routeSegments: string[];
}

export interface LayoutResult {
  boxes: Map<string, NodeBox>;
  segmentLines: Map<string, SegmentLine>;
  wirePaths: Map<string, WirePath>;
  bounds: { x: number; y: number; width: number; height: number };
}

export const CONNECTOR_WIDTH = 160;
export const CONNECTOR_HEADER = 34;
export const PIN_ROW = 18;
const H_GAP = 210;
const V_GAP = 44;

function nodeSize(node: HarnessNode): { width: number; height: number } {
  switch (node.kind) {
    case "connector":
      return { width: CONNECTOR_WIDTH, height: CONNECTOR_HEADER + node.pins.length * PIN_ROW };
    case "terminal":
      return { width: 110, height: 44 };
    case "splice":
      return { width: 28, height: 28 };
    case "breakout":
      return { width: 14, height: 14 };
  }
}

export function pickRoot(harness: Harness): string {
  if (harness.layout?.root) return harness.layout.root;
  const connector = harness.nodes.find((n) => n.kind === "connector");
  return (connector ?? harness.nodes[0]).id;
}

export function resolveRoute(harness: Harness, wireId: string): string[] {
  const wire = harness.wires.find((w) => w.id === wireId);
  if (!wire) return [];
  if (wire.route) return wire.route;
  return (
    findSegmentPath(harness, parseEndpoint(wire.from).nodeId, parseEndpoint(wire.to).nodeId) ?? []
  );
}

export function layoutHarness(harness: Harness): LayoutResult {
  const rootId = pickRoot(harness);
  const nodeById = new Map(harness.nodes.map((n) => [n.id, n]));

  // Build tree structure (children ordered by segment declaration order)
  const children = new Map<string, string[]>();
  const parent = new Map<string, string>();
  const visited = new Set<string>([rootId]);
  const queue = [rootId];
  while (queue.length > 0) {
    const current = queue.shift()!;
    children.set(current, children.get(current) ?? []);
    for (const seg of harness.segments) {
      let other: string | null = null;
      if (seg.from === current && !visited.has(seg.to)) other = seg.to;
      else if (seg.to === current && !visited.has(seg.from)) other = seg.from;
      if (other) {
        visited.add(other);
        parent.set(other, current);
        children.get(current)!.push(other);
        queue.push(other);
      }
    }
  }

  // Depth per node, max width per depth column
  const depth = new Map<string, number>();
  const assignDepth = (id: string, d: number) => {
    depth.set(id, d);
    for (const child of children.get(id) ?? []) assignDepth(child, d + 1);
  };
  assignDepth(rootId, 0);

  const maxDepth = Math.max(...[...depth.values()], 0);
  const columnWidth: number[] = [];
  for (const [id, d] of depth) {
    const { width } = nodeSize(nodeById.get(id)!);
    columnWidth[d] = Math.max(columnWidth[d] ?? 0, width);
  }
  const columnX: number[] = [];
  let cx = 0;
  for (let d = 0; d <= maxDepth; d++) {
    columnX[d] = cx;
    cx += (columnWidth[d] ?? 0) + H_GAP;
  }

  // Vertical placement: leaves stacked in DFS order, internals centered on children
  const centerY = new Map<string, number>();
  let cursor = 0;
  const place = (id: string): number => {
    const kids = children.get(id) ?? [];
    const { height } = nodeSize(nodeById.get(id)!);
    if (kids.length === 0) {
      const center = cursor + height / 2;
      cursor += height + V_GAP;
      centerY.set(id, center);
      return center;
    }
    const centers = kids.map(place);
    const center = (centers[0] + centers[centers.length - 1]) / 2;
    centerY.set(id, center);
    return center;
  };
  place(rootId);

  const boxes = new Map<string, NodeBox>();
  for (const node of harness.nodes) {
    const { width, height } = nodeSize(node);
    const d = depth.get(node.id) ?? 0;
    const autoX = columnX[d] + ((columnWidth[d] ?? width) - width) / 2;
    const autoY = (centerY.get(node.id) ?? 0) - height / 2;
    const x = node.position?.x ?? autoX;
    const y = node.position?.y ?? autoY;
    const facesRight = node.id === rootId;

    const pinAnchors = new Map<string, Point>();
    if (node.kind === "connector") {
      node.pins.forEach((pin, i) => {
        pinAnchors.set(pin.id, {
          x: facesRight ? x + width : x,
          y: y + CONNECTOR_HEADER + i * PIN_ROW + PIN_ROW / 2,
        });
      });
    }
    boxes.set(node.id, { node, x, y, width, height, pinAnchors, facesRight });
  }

  // Segment attachment points, spread along the node edge facing the other end
  const segmentsAtNode = new Map<string, Segment[]>();
  for (const seg of harness.segments) {
    for (const id of [seg.from, seg.to]) {
      if (!segmentsAtNode.has(id)) segmentsAtNode.set(id, []);
      segmentsAtNode.get(id)!.push(seg);
    }
  }

  const attachPoint = (nodeId: string, seg: Segment): Point => {
    const box = boxes.get(nodeId)!;
    const otherId = seg.from === nodeId ? seg.to : seg.from;
    const other = boxes.get(otherId)!;
    const rightSide = other.x + other.width / 2 >= box.x + box.width / 2;
    const sameSide = (segmentsAtNode.get(nodeId) ?? []).filter((s) => {
      const oId = s.from === nodeId ? s.to : s.from;
      const o = boxes.get(oId)!;
      return (o.x + o.width / 2 >= box.x + box.width / 2) === rightSide;
    });
    const sorted = [...sameSide].sort((a, b) => {
      const ay = boxes.get(a.from === nodeId ? a.to : a.from)!.y;
      const by = boxes.get(b.from === nodeId ? b.to : b.from)!.y;
      return ay - by;
    });
    const idx = sorted.indexOf(seg);
    const y = box.y + (box.height * (idx + 1)) / (sorted.length + 1);
    return { x: rightSide ? box.x + box.width : box.x, y };
  };

  const segmentLines = new Map<string, SegmentLine>();
  for (const seg of harness.segments) {
    segmentLines.set(seg.id, {
      segment: seg,
      from: attachPoint(seg.from, seg),
      to: attachPoint(seg.to, seg),
      wires: [],
    });
  }

  // Register wires on segments (defines their perpendicular offset order)
  const wireRoutes = new Map<string, string[]>();
  for (const wire of harness.wires) {
    const route = resolveRoute(harness, wire.id);
    wireRoutes.set(wire.id, route);
    for (const segId of route) segmentLines.get(segId)?.wires.push(wire.id);
  }

  // Wire polylines
  const wirePaths = new Map<string, WirePath>();
  for (const wire of harness.wires) {
    const route = wireRoutes.get(wire.id) ?? [];
    const points: Point[] = [];

    const endpointAnchor = (ref: string): Point => {
      const { nodeId, pinId } = parseEndpoint(ref);
      const box = boxes.get(nodeId)!;
      if (pinId && box.pinAnchors.has(pinId)) return box.pinAnchors.get(pinId)!;
      return { x: box.facesRight ? box.x + box.width : box.x, y: box.y + box.height / 2 };
    };

    points.push(endpointAnchor(wire.from));
    let currentNode = parseEndpoint(wire.from).nodeId;
    for (const segId of route) {
      const line = segmentLines.get(segId)!;
      const seg = line.segment;
      const idx = line.wires.indexOf(wire.id);
      const n = line.wires.length;
      const offset = (idx - (n - 1) / 2) * 4;
      const dx = line.to.x - line.from.x;
      const dy = line.to.y - line.from.y;
      const len = Math.hypot(dx, dy) || 1;
      const ox = (-dy / len) * offset;
      const oy = (dx / len) * offset;
      const nearFirst = seg.from === currentNode;
      const a = nearFirst ? line.from : line.to;
      const b = nearFirst ? line.to : line.from;
      points.push({ x: a.x + ox, y: a.y + oy });
      points.push({ x: b.x + ox, y: b.y + oy });
      currentNode = nearFirst ? seg.to : seg.from;
    }
    points.push(endpointAnchor(wire.to));
    wirePaths.set(wire.id, { wireId: wire.id, points, routeSegments: route });
  }

  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const box of boxes.values()) {
    minX = Math.min(minX, box.x);
    minY = Math.min(minY, box.y);
    maxX = Math.max(maxX, box.x + box.width);
    maxY = Math.max(maxY, box.y + box.height);
  }
  // Room for segment labels below lines
  maxY += 30;

  return {
    boxes,
    segmentLines,
    wirePaths,
    bounds: { x: minX, y: minY, width: maxX - minX, height: maxY - minY },
  };
}
