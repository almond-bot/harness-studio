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

/**
 * The harness's separate runs: groups of nodes joined by segments, each in
 * node declaration order, the groups ordered by their first node. Most
 * harnesses are one run; a cable sold as two loose runs (power to one plug,
 * a signal pair to its own) is two.
 */
export function connectedRuns(harness: Harness): string[][] {
  const adj = buildAdjacency(harness);
  const seen = new Set<string>();
  const runs: string[][] = [];
  for (const node of harness.nodes) {
    if (seen.has(node.id)) continue;
    const members = new Set<string>([node.id]);
    seen.add(node.id);
    const queue = [node.id];
    while (queue.length > 0) {
      const current = queue.shift()!;
      for (const next of adj.neighbors.get(current) ?? []) {
        if (!seen.has(next)) {
          seen.add(next);
          members.add(next);
          queue.push(next);
        }
      }
    }
    runs.push(harness.nodes.filter((n) => members.has(n.id)).map((n) => n.id));
  }
  return runs;
}

/**
 * Returns issues if the segment graph is not a tree, or a set of separate
 * trees (runs). Every node needs a segment; a run can't loop back on itself.
 */
export function checkTree(harness: Harness): string[] {
  const issues: string[] = [];
  const nodeCount = harness.nodes.length;
  const segCount = harness.segments.length;
  if (nodeCount > 1) {
    const adj = buildAdjacency(harness);
    const unreached = harness.nodes
      .filter((n) => (adj.neighbors.get(n.id) ?? []).length === 0)
      .map((n) => n.id);
    if (unreached.length > 0) {
      issues.push(`nodes not connected to the harness by any segment: ${unreached.join(", ")}`);
    } else {
      const runs = connectedRuns(harness).length;
      if (segCount > nodeCount - runs) {
        issues.push(
          `segment graph has a cycle (${segCount} segments for ${nodeCount} nodes in ${runs} run${runs === 1 ? "" : "s"}); a harness must be a tree, or separate trees`
        );
      }
    }
  }
  return issues;
}
