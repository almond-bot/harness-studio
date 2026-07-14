import { useCallback, useEffect, useState } from "react";
import {
  validateHarness,
  renderHarnessSvg,
  type Harness,
  type ValidationIssue,
} from "@almond-harness-studio/core";

export interface LoadedHarness {
  sourceName: string;
  harness?: Harness;
  svg?: string;
  sheetWidth?: number;
  sheetHeight?: number;
  errors: ValidationIssue[];
  warnings: ValidationIssue[];
}

export function parseHarnessText(sourceName: string, content: string): LoadedHarness {
  let data: unknown;
  try {
    data = JSON.parse(content);
  } catch (err) {
    return {
      sourceName,
      errors: [{ path: "/", message: `invalid JSON: ${(err as Error).message}` }],
      warnings: [],
    };
  }
  const result = validateHarness(data);
  if (!result.valid || !result.harness) {
    return { sourceName, errors: result.errors, warnings: result.warnings };
  }
  try {
    const { svg, width, height } = renderHarnessSvg(result.harness);
    return {
      sourceName,
      harness: result.harness,
      svg,
      sheetWidth: width,
      sheetHeight: height,
      errors: [],
      warnings: result.warnings,
    };
  } catch (err) {
    return {
      sourceName,
      harness: result.harness,
      errors: [{ path: "/", message: `render failed: ${(err as Error).message}` }],
      warnings: result.warnings,
    };
  }
}

export interface ServerState {
  connected: boolean;
  /** true once the initial /api/files probe has resolved either way */
  checked: boolean;
  dataDir?: string;
  files: string[];
}

export function useHarnessServer() {
  const [server, setServer] = useState<ServerState>({ connected: false, checked: false, files: [] });

  const refresh = useCallback(async () => {
    try {
      const res = await fetch("/api/files");
      if (!res.ok) throw new Error();
      const body = (await res.json()) as { dataDir: string; files: string[] };
      setServer({ connected: true, checked: true, dataDir: body.dataDir, files: body.files });
      return body.files;
    } catch {
      setServer({ connected: false, checked: true, files: [] });
      return [];
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return { server, refresh };
}

export async function fetchHarnessFile(path: string): Promise<LoadedHarness> {
  const res = await fetch(`/api/file?path=${encodeURIComponent(path)}`);
  if (!res.ok) {
    return { sourceName: path, errors: [{ path: "/", message: "failed to load file" }], warnings: [] };
  }
  const body = (await res.json()) as { content: string };
  return parseHarnessText(path, body.content);
}
