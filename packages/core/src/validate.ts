import { Ajv, type ErrorObject } from "ajv";
import schema from "./schema.json" with { type: "json" };
import type { ConnectorNode, Harness } from "./types.js";
import { parseEndpoint } from "./types.js";
import { checkTree, findSegmentPath } from "./graph.js";

export interface ValidationIssue {
  path: string;
  message: string;
}

export interface ValidationResult {
  valid: boolean;
  errors: ValidationIssue[];
  warnings: ValidationIssue[];
  /** Present when schema validation passed */
  harness?: Harness;
}

const ajv = new Ajv({ allErrors: true, allowUnionTypes: true });
const schemaValidate = ajv.compile(schema);

function formatAjvError(err: ErrorObject): ValidationIssue {
  const path = err.instancePath || "/";
  let message = err.message ?? "invalid";
  if (err.keyword === "additionalProperties") {
    message = `unknown property "${(err.params as { additionalProperty: string }).additionalProperty}"`;
  } else if (err.keyword === "enum") {
    message = `${message}: ${(err.params as { allowedValues: unknown[] }).allowedValues.join(", ")}`;
  }
  return { path, message };
}

function checkDuplicates(items: { id: string }[], label: string, errors: ValidationIssue[]) {
  const seen = new Set<string>();
  for (const item of items) {
    if (seen.has(item.id)) {
      errors.push({ path: `/${label}`, message: `duplicate ${label} id "${item.id}"` });
    }
    seen.add(item.id);
  }
}

export function validateHarness(data: unknown): ValidationResult {
  if (!schemaValidate(data)) {
    const errors = (schemaValidate.errors ?? []).map(formatAjvError);
    return { valid: false, errors, warnings: [] };
  }

  const harness = data as unknown as Harness;
  const errors: ValidationIssue[] = [];
  const warnings: ValidationIssue[] = [];

  checkDuplicates(harness.nodes, "nodes", errors);
  checkDuplicates(harness.segments, "segments", errors);
  checkDuplicates(harness.wires, "wires", errors);

  const nodeById = new Map(harness.nodes.map((n) => [n.id, n]));

  harness.segments.forEach((seg, i) => {
    for (const end of ["from", "to"] as const) {
      if (!nodeById.has(seg[end])) {
        errors.push({
          path: `/segments/${i}/${end}`,
          message: `segment "${seg.id}" references unknown node "${seg[end]}"`,
        });
      }
    }
    if (seg.from === seg.to) {
      errors.push({ path: `/segments/${i}`, message: `segment "${seg.id}" connects a node to itself` });
    }
  });

  if (errors.length === 0) {
    for (const issue of checkTree(harness)) {
      errors.push({ path: "/segments", message: issue });
    }
  }

  const segmentById = new Map(harness.segments.map((s) => [s.id, s]));

  harness.wires.forEach((wire, i) => {
    for (const end of ["from", "to"] as const) {
      const ref = parseEndpoint(wire[end]);
      const node = nodeById.get(ref.nodeId);
      if (!node) {
        errors.push({
          path: `/wires/${i}/${end}`,
          message: `wire "${wire.id}" references unknown node "${ref.nodeId}"`,
        });
        continue;
      }
      if (node.kind === "connector") {
        if (!ref.pinId) {
          errors.push({
            path: `/wires/${i}/${end}`,
            message: `wire "${wire.id}" must reference a pin on connector "${node.id}" (e.g. "${node.id}.${(node as ConnectorNode).pins[0]?.id ?? "1"}")`,
          });
        } else if (!(node as ConnectorNode).pins.some((p) => p.id === ref.pinId)) {
          errors.push({
            path: `/wires/${i}/${end}`,
            message: `wire "${wire.id}" references unknown pin "${ref.pinId}" on connector "${node.id}" (pins: ${(node as ConnectorNode).pins.map((p) => p.id).join(", ")})`,
          });
        }
      } else if (ref.pinId) {
        errors.push({
          path: `/wires/${i}/${end}`,
          message: `wire "${wire.id}" references pin "${ref.pinId}" but node "${node.id}" is a ${node.kind} and has no pins`,
        });
      }
    }

    if (wire.route) {
      let previousNode = parseEndpoint(wire.from).nodeId;
      for (const segId of wire.route) {
        const seg = segmentById.get(segId);
        if (!seg) {
          errors.push({
            path: `/wires/${i}/route`,
            message: `wire "${wire.id}" route references unknown segment "${segId}"`,
          });
          previousNode = "";
          break;
        }
        if (seg.from === previousNode) previousNode = seg.to;
        else if (seg.to === previousNode) previousNode = seg.from;
        else {
          errors.push({
            path: `/wires/${i}/route`,
            message: `wire "${wire.id}" route is not contiguous at segment "${segId}"`,
          });
          previousNode = "";
          break;
        }
      }
      if (previousNode && previousNode !== parseEndpoint(wire.to).nodeId) {
        errors.push({
          path: `/wires/${i}/route`,
          message: `wire "${wire.id}" route ends at node "${previousNode}" but the wire's "to" endpoint is on node "${parseEndpoint(wire.to).nodeId}"`,
        });
      }
    }
  });

  // Auto-routing feasibility (only when the graph itself is sound)
  if (errors.length === 0) {
    harness.wires.forEach((wire, i) => {
      if (!wire.route) {
        const path = findSegmentPath(
          harness,
          parseEndpoint(wire.from).nodeId,
          parseEndpoint(wire.to).nodeId
        );
        if (path === null) {
          errors.push({
            path: `/wires/${i}`,
            message: `no segment path exists between the endpoints of wire "${wire.id}"`,
          });
        }
      }
    });
  }

  const wireById = new Map(harness.wires.map((w) => [w.id, w]));
  (harness.wireGroups ?? []).forEach((group, i) => {
    for (const wireId of group.wires) {
      if (!wireById.has(wireId)) {
        errors.push({
          path: `/wireGroups/${i}`,
          message: `wire group references unknown wire "${wireId}"`,
        });
      }
    }
  });

  if (harness.layout?.root && !nodeById.has(harness.layout.root)) {
    errors.push({
      path: "/layout/root",
      message: `layout root references unknown node "${harness.layout.root}"`,
    });
  }

  const connectorCount = harness.nodes.filter((n) => n.kind === "connector").length;
  if (connectorCount === 0) {
    warnings.push({ path: "/nodes", message: "harness has no connectors" });
  }
  harness.wires.forEach((wire, i) => {
    if (!wire.gauge) warnings.push({ path: `/wires/${i}`, message: `wire "${wire.id}" has no gauge` });
    if (!wire.color) warnings.push({ path: `/wires/${i}`, message: `wire "${wire.id}" has no color` });
  });

  return { valid: errors.length === 0, errors, warnings, harness };
}
