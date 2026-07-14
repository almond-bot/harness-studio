import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { collectPartRefs, partKey } from "@almond-harness-studio/core";
import { Preview } from "./Preview";
import {
  fetchHarnessFile,
  parseHarnessText,
  useHarnessServer,
  type LoadedHarness,
} from "./useHarness";
import { downloadPdf, downloadSvg, printSheet } from "./exportPdf";
import { SettingsDialog, loadVendorKeys, type VendorKeys } from "./Settings";

const canPickFiles = typeof window !== "undefined" && !!window.showOpenFilePicker;
const canPickFolder = typeof window !== "undefined" && !!window.showDirectoryPicker;

interface FolderFile {
  name: string;
  handle: FileSystemFileHandle;
}

export function App() {
  const { server, refresh } = useHarnessServer();
  const [selected, setSelected] = useState<string | null>(null);
  const [loaded, setLoaded] = useState<LoadedHarness | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const [watchedHandle, setWatchedHandle] = useState<FileSystemFileHandle | null>(null);
  const [folder, setFolder] = useState<FileSystemDirectoryHandle | null>(null);
  const [folderFiles, setFolderFiles] = useState<FolderFile[]>([]);
  const [folderSelected, setFolderSelected] = useState<string | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [keys, setKeys] = useState<VendorKeys>(() => loadVendorKeys());
  const [fetchingParts, setFetchingParts] = useState(false);
  const [partsError, setPartsError] = useState<string | null>(null);
  const lastModified = useRef(0);

  const unresolvedParts = useMemo(() => {
    const harness = loaded?.harness;
    if (!harness) return 0;
    const cache = harness.parts ?? {};
    return collectPartRefs(harness).filter((ref) => !cache[partKey(ref)]).length;
  }, [loaded]);

  const fetchParts = useCallback(async () => {
    if (!selected) return;
    setFetchingParts(true);
    setPartsError(null);
    try {
      const res = await fetch("/api/parts/fetch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ path: selected, keys }),
      });
      const body = (await res.json()) as { failures?: { part: string; error: string }[] };
      if (body.failures?.length) {
        setPartsError(body.failures.map((f) => `${f.part}: ${f.error}`).join("; "));
      }
      // File was rewritten with embedded parts; reload to re-render
      setLoaded(await fetchHarnessFile(selected));
    } catch (err) {
      setPartsError((err as Error).message);
    } finally {
      setFetchingParts(false);
    }
  }, [selected, keys]);

  const openFile = useCallback(async (path: string) => {
    setWatchedHandle(null);
    setSelected(path);
    setLoaded(await fetchHarnessFile(path));
  }, []);

  const watchHandle = useCallback(async (handle: FileSystemFileHandle) => {
    setSelected(null);
    setWatchedHandle(handle);
    const file = await handle.getFile();
    lastModified.current = file.lastModified;
    setLoaded(parseHarnessText(handle.name, await file.text()));
  }, []);

  // Live re-render for a locally opened file (File System Access API): poll lastModified
  useEffect(() => {
    if (!watchedHandle) return;
    const timer = setInterval(async () => {
      try {
        const file = await watchedHandle.getFile();
        if (file.lastModified !== lastModified.current) {
          lastModified.current = file.lastModified;
          setLoaded(parseHarnessText(watchedHandle.name, await file.text()));
        }
      } catch {
        // File moved/deleted or permission revoked; keep the last render
      }
    }, 750);
    return () => clearInterval(timer);
  }, [watchedHandle]);

  const pickFile = useCallback(async () => {
    if (!window.showOpenFilePicker) return;
    try {
      const [handle] = await window.showOpenFilePicker({
        types: [{ description: "Harness JSON", accept: { "application/json": [".json"] } }],
      });
      if (handle) {
        setFolder(null);
        setFolderFiles([]);
        setFolderSelected(null);
        await watchHandle(handle);
      }
    } catch {
      // picker dismissed
    }
  }, [watchHandle]);

  const scanFolder = useCallback(async (dir: FileSystemDirectoryHandle): Promise<FolderFile[]> => {
    const files: FolderFile[] = [];
    for await (const entry of dir.values()) {
      if (entry.kind === "file" && entry.name.endsWith(".harness.json")) {
        files.push({ name: entry.name, handle: entry as FileSystemFileHandle });
      }
    }
    files.sort((a, b) => a.name.localeCompare(b.name));
    return files;
  }, []);

  const openFolder = useCallback(
    async (dir: FileSystemDirectoryHandle) => {
      const files = await scanFolder(dir);
      setFolder(dir);
      setFolderFiles(files);
      setSelected(null);
      if (files.length > 0) {
        setFolderSelected(files[0].name);
        await watchHandle(files[0].handle);
      } else {
        setFolderSelected(null);
        setWatchedHandle(null);
        setLoaded(null);
      }
    },
    [scanFolder, watchHandle]
  );

  const pickFolder = useCallback(async () => {
    if (!window.showDirectoryPicker) return;
    try {
      await openFolder(await window.showDirectoryPicker());
    } catch {
      // picker dismissed
    }
  }, [openFolder]);

  // Keep the folder listing fresh: pick up files the user (or agent) adds/removes
  useEffect(() => {
    if (!folder) return;
    const timer = setInterval(async () => {
      try {
        const files = await scanFolder(folder);
        setFolderFiles((prev) => {
          const same = prev.length === files.length && prev.every((p, i) => p.name === files[i].name);
          return same ? prev : files;
        });
      } catch {
        // Permission revoked; keep the last listing
      }
    }, 2500);
    return () => clearInterval(timer);
  }, [folder, scanFolder]);

  // Auto-select first file once the server responds
  useEffect(() => {
    if (server.connected && server.files.length > 0 && !selected && !watchedHandle) {
      void openFile(server.files[0]);
    }
  }, [server, selected, watchedHandle, openFile]);

  // Live reload via SSE (local dev server mode)
  useEffect(() => {
    if (!server.connected) return;
    const source = new EventSource("/api/events");
    source.onmessage = (e) => {
      if (e.data !== "change") return;
      void refresh().then((files) => {
        if (watchedHandle) return;
        if (selected && files.includes(selected)) void openFile(selected);
        else if (files.length > 0) void openFile(files[0]);
      });
    };
    return () => source.close();
  }, [server.connected, selected, watchedHandle, refresh, openFile]);

  const onDrop = useCallback(
    async (e: React.DragEvent) => {
      e.preventDefault();
      setDragOver(false);
      const item = e.dataTransfer.items?.[0];
      // Must be requested synchronously during the drop event
      const handlePromise = item?.getAsFileSystemHandle?.();
      const file = e.dataTransfer.files[0];
      if (handlePromise) {
        const handle = await handlePromise;
        if (handle?.kind === "directory") {
          await openFolder(handle as unknown as FileSystemDirectoryHandle);
          return;
        }
        if (handle?.kind === "file") {
          setFolder(null);
          setFolderFiles([]);
          setFolderSelected(null);
          await watchHandle(handle as FileSystemFileHandle);
          return;
        }
      }
      if (!file) return;
      setWatchedHandle(null);
      setSelected(null);
      setFolder(null);
      setFolderFiles([]);
      setFolderSelected(null);
      setLoaded(parseHarnessText(file.name, await file.text()));
    },
    [watchHandle, openFolder]
  );

  const baseName = loaded?.sourceName.replace(/\.harness\.json$|\.json$/, "").split("/").pop() ?? "harness";

  return (
    <div
      className={`app${dragOver ? " drag-over" : ""}`}
      onDragOver={(e) => {
        e.preventDefault();
        setDragOver(true);
      }}
      onDragLeave={() => setDragOver(false)}
      onDrop={onDrop}
    >
      <aside className="sidebar">
        <div className="brand">
          <img src="/almond.svg" alt="Almond" /> Almond Harness Studio
        </div>
        {server.connected ? (
          <>
            <div className="data-dir" title={server.dataDir}>
              {server.dataDir}
            </div>
            <ul className="file-list">
              {server.files.map((file) => (
                <li key={file}>
                  <button
                    className={selected === file ? "active" : ""}
                    onClick={() => void openFile(file)}
                  >
                    {file}
                  </button>
                </li>
              ))}
              {server.files.length === 0 && <li className="empty">no .harness.json files found</li>}
            </ul>
          </>
        ) : folder ? (
          <>
            <div className="data-dir" title={folder.name}>
              {folder.name}/
            </div>
            <ul className="file-list">
              {folderFiles.map((f) => (
                <li key={f.name}>
                  <button
                    className={folderSelected === f.name ? "active" : ""}
                    onClick={() => {
                      setFolderSelected(f.name);
                      void watchHandle(f.handle);
                    }}
                  >
                    {f.name}
                  </button>
                </li>
              ))}
              {folderFiles.length === 0 && <li className="empty">no .harness.json files found</li>}
            </ul>
            <div className="offline">
              <button className="open-file" onClick={() => void pickFolder()}>
                Open another folder…
              </button>
            </div>
          </>
        ) : (
          <div className="offline">
            <p>
              Preview <code>.harness.json</code> files from your machine. Files are read in-browser
              and never uploaded.
            </p>
            {canPickFiles && (
              <button className="open-file" onClick={() => void pickFile()}>
                Open harness file…
              </button>
            )}
            {canPickFolder && (
              <button className="open-file" onClick={() => void pickFolder()}>
                Open folder…
              </button>
            )}
            <p className="offline-hint">
              {canPickFiles
                ? "Opened files live-reload as you (or your agent) save them."
                : "Drop a file anywhere to preview it. For live reload, use Chrome/Edge or run the CLI locally."}
            </p>
          </div>
        )}
        {watchedHandle && (
          <div className="watching">
            <span className="live-dot" /> watching {watchedHandle.name}
          </div>
        )}
        <div className="sidebar-footer">
          <button className="link-button" onClick={() => setSettingsOpen(true)}>
            API keys…
          </button>
          <a href="https://github.com/almond-bot/harness-studio" target="_blank" rel="noreferrer">
            open source · MIT · Almond AI, Inc.
          </a>
        </div>
      </aside>

      {settingsOpen && (
        <SettingsDialog initial={keys} onSave={setKeys} onClose={() => setSettingsOpen(false)} />
      )}

      <main className="main">
        {loaded && (
          <header className="toolbar">
            <div className="title">
              <strong>{loaded.harness?.meta.title ?? loaded.sourceName}</strong>
              {loaded.harness?.meta.partNumber && <span>{loaded.harness.meta.partNumber}</span>}
              {loaded.harness?.meta.rev && <span>REV {loaded.harness.meta.rev}</span>}
            </div>
            {loaded.svg && (
              <div className="actions">
                {unresolvedParts > 0 && server.connected && selected && (
                  <button className="fetch-parts" disabled={fetchingParts} onClick={() => void fetchParts()}>
                    {fetchingParts ? "Fetching…" : `Fetch ${unresolvedParts} part${unresolvedParts > 1 ? "s" : ""}`}
                  </button>
                )}
                <button
                  onClick={() =>
                    void downloadPdf(loaded.svg!, loaded.sheetWidth!, loaded.sheetHeight!, baseName)
                  }
                >
                  Download PDF
                </button>
                <button onClick={() => downloadSvg(loaded.svg!, baseName)}>SVG</button>
                <button onClick={() => printSheet(loaded.svg!, loaded.sheetWidth!, loaded.sheetHeight!)}>
                  Print
                </button>
              </div>
            )}
          </header>
        )}

        {partsError && (
          <div className="issues errors">
            <strong>part lookup failed</strong>
            <ul>
              <li>{partsError}</li>
            </ul>
          </div>
        )}
        {loaded?.errors.length ? (
          <div className="issues errors">
            <strong>{loaded.errors.length} error(s)</strong>
            <ul>
              {loaded.errors.map((issue, i) => (
                <li key={i}>
                  <code>{issue.path}</code> {issue.message}
                </li>
              ))}
            </ul>
          </div>
        ) : null}
        {loaded?.warnings.length ? (
          <div className="issues warnings">
            <ul>
              {loaded.warnings.map((issue, i) => (
                <li key={i}>
                  <code>{issue.path}</code> {issue.message}
                </li>
              ))}
            </ul>
          </div>
        ) : null}

        {loaded?.svg ? (
          <Preview svg={loaded.svg} sheetWidth={loaded.sheetWidth!} sheetHeight={loaded.sheetHeight!} />
        ) : (
          !loaded && (
            <div className="placeholder">
              <h1>Almond Harness Studio</h1>
              <p>Wire harness drawings from JSON — live preview, BOM, wire list, PDF export.</p>
              <p className="hint">
                {server.connected
                  ? "Select a harness from the sidebar."
                  : canPickFiles
                    ? "Open a folder or drop a .harness.json file to get started."
                    : "Drop a .harness.json file here to get started."}
              </p>
              {!server.connected && canPickFiles && (
                <button className="open-file big" onClick={() => void pickFile()}>
                  Open harness file…
                </button>
              )}
              {!server.connected && canPickFolder && (
                <button className="open-file big" onClick={() => void pickFolder()}>
                  Open folder…
                </button>
              )}
            </div>
          )
        )}
      </main>
    </div>
  );
}
