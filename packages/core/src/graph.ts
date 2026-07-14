import type { Harness, Segment } from "./types.js";

export interface Adjacency {
  /** nodeId -> segments touching it */
  bySegment: Map<string, Segment[]>;
  /** nodeId -> neighbor nodeIds */
  neighbors: Map<string, string[]>;
}

export function buildAdjacency(harness: Harness): Adjacency {
  const bySegment = new Map<string, Segment[]>();
  const neighbors = new Map<string, string[]>();
  for (const node of harness.nodes) {
    bySegment.set(node.id, []);
    neighbors.set(node.id, []);
  }
  for (const seg of harness.segments) {
    bySegment.get(seg.from)?.push(seg);
    bySegment.get(seg.to)?.push(seg);
    neighbors.get(seg.from)?.push(seg.to);
    neighbors.get(seg.to)?.push(seg.from);
  }
  return { bySegment, neighbors };
}

/** BFS path between two nodes; returns the segment ids along the path, or null. */
export function findSegmentPath(harness: Harness, fromNode: string, toNode: string): string[] | null {
  if (fromNode === toNode) return [];
  const adj = buildAdjacency(harness);
  const prev = new Map<string, { node: string; segment: Segment }>();
  const visited = new Set<string>([fromNode]);
  const queue = [fromNode];
  while (queue.length > 0) {
    const current = queue.shift()!;
    for (const seg of adj.bySegment.get(current) ?? []) {
      const next = seg.from === current ? seg.to : seg.from;
      if (visited.has(next)) continue;
      visited.add(next);
      prev.set(next, { node: current, segment: seg });
      if (next === toNode) {
        const path: string[] = [];
        let walk = toNode;
        while (walk !== fromNode) {
          const step = prev.get(walk)!;
          path.unshift(step.segment.id);
          walk = step.node;
        }
        return path;
      }
      queue.push(next);
    }
  }
  return null;
}

/** Returns issues if the segment graph is not a connected tree. */
export function checkTree(harness: Harness): string[] {
  const issues: string[] = [];
  const nodeCount = harness.nodes.length;
  const segCount = harness.segments.length;
  if (nodeCount > 1) {
    const adj = buildAdjacency(harness);
    const visited = new Set<string>();
    const start = harness.nodes[0].id;
    const queue = [start];
    visited.add(start);
    while (queue.length > 0) {
      const current = queue.shift()!;
      for (const next of adj.neighbors.get(current) ?? []) {
        if (!visited.has(next)) {
          visited.add(next);
          queue.push(next);
        }
      }
    }
    const unreached = harness.nodes.filter((n) => !visited.has(n.id)).map((n) => n.id);
    if (unreached.length > 0) {
      issues.push(`nodes not connected to the harness by any segment: ${unreached.join(", ")}`);
    } else if (segCount > nodeCount - 1) {
      issues.push(
        `segment graph has a cycle (${segCount} segments for ${nodeCount} nodes); a harness must be a tree`
      );
    }
  }
  return issues;
}
