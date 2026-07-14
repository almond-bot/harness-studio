const WIRE_COLORS: Record<string, string> = {
  black: "#1a1a1a",
  brown: "#7b4a12",
  red: "#d32f2f",
  orange: "#ef7c00",
  yellow: "#e6c700",
  green: "#2e8b3d",
  blue: "#1e63c8",
  violet: "#7b3fbf",
  purple: "#7b3fbf",
  gray: "#8a8a8a",
  grey: "#8a8a8a",
  white: "#f2f2f2",
  pink: "#e87ea1",
  tan: "#d2b48c",
};

export interface WireColor {
  base: string;
  stripe?: string;
  /** Uppercased short code for tables, e.g. "RED/WHT" */
  code: string;
}

const CODES: Record<string, string> = {
  black: "BLK",
  brown: "BRN",
  red: "RED",
  orange: "ORG",
  yellow: "YEL",
  green: "GRN",
  blue: "BLU",
  violet: "VIO",
  purple: "VIO",
  gray: "GRY",
  grey: "GRY",
  white: "WHT",
  pink: "PNK",
  tan: "TAN",
};

/** Parses "red" or "red/white" (stripe) into render colors. Unknown names pass through as-is. */
export function parseWireColor(color: string | undefined): WireColor {
  if (!color) return { base: "#555555", code: "—" };
  const [baseName, stripeName] = color.split("/").map((c) => c.trim().toLowerCase());
  const base = WIRE_COLORS[baseName] ?? baseName;
  const stripe = stripeName ? (WIRE_COLORS[stripeName] ?? stripeName) : undefined;
  const code = [CODES[baseName] ?? baseName.toUpperCase(), stripeName ? (CODES[stripeName] ?? stripeName.toUpperCase()) : null]
    .filter(Boolean)
    .join("/");
  return { base, stripe, code };
}
