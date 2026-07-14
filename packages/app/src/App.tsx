import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { collectPartRefs, partKey } from "@almond-bot/harness-studio-core";
import { Preview } from "./Preview";
import {
  fetchHarnessFile,
  parseHarnessText,
  useHarnessServer,
  type LoadedHarness,
} from "./useHarness";
import { downloadPdf, downloadSvg, printSheet } from "./exportPdf";
import { SettingsDialog, loadVendorKeys, type VendorKeys } from "./Settings";
import { demos } from "./demos";
import {
  clearLastOpened,
  loadLastOpened,
  saveLastOpened,
  type LastOpened,
} from "./lastOpened";

const canPickFiles = typeof window !== "undefined" && !!window.showOpenFilePicker;
const canPickFolder = typeof window !== "undefined" && !!window.showDirectoryPicker;

/** Tracks prefers-color-scheme; the preview follows it while exports stay light. */
function useSystemDark(): boolean {
  const [dark, setDark] = useState(
    () => typeof window !== "undefined" && window.matchMedia("(prefers-color-scheme: dark)").matches
  );
  useEffect(() => {
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = (e: MediaQueryListEvent) => setDark(e.matches);
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);
  return dark;
}

interface FolderFile {
  name: string;
  handle: FileSystemFileHandle;
}

export function App() {
  const { server, refresh } = useHarnessServer();
  const systemDark = useSystemDark();
  const [selected, setSelected] = useState<string | null>(null);
  const [loaded, setLoaded] = useState<LoadedHarness | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const [watchedHandle, setWatchedHandle] = useState<FileSystemFileHandle | null>(null);
  const [folder, setFolder] = useState<FileSystemDirectoryHandle | null>(null);
  const [folderFiles, setFolderFiles] = useState<FolderFile[]>([]);
  const [folderSelected, setFolderSelected] = useState<string | null>(null);
  const [demoSelected, setDemoSelected] = useState<string | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [keys, setKeys] = useState<VendorKeys>(() => loadVendorKeys());
  const [fetchingParts, setFetchingParts] = useState(false);
  const [partsError, setPartsError] = useState<string | null>(null);
  const [resume, setResume] = useState<LastOpened | null>(null);
  const lastModified = useRef(0);
  const restoreAttempted = useRef(false);

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
    setDemoSelected(null);
    setSelected(path);
    setLoaded(await fetchHarnessFile(path));
  }, []);

  const openDemo = useCallback((name: string) => {
    const demo = demos.find((d) => d.name === name);
    if (!demo) return;
    setSelected(null);
    setWatchedHandle(null);
    setDemoSelected(name);
    setLoaded(demo.load());
  }, []);

  const watchHandle = useCallback(async (handle: FileSystemFileHandle) => {
    setSelected(null);
    setDemoSelected(null);
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
        setResume(null);
        await watchHandle(handle);
        void saveLastOpened({ kind: "file", handle });
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
    async (dir: FileSystemDirectoryHandle, preferredFile?: string) => {
      const files = await scanFolder(dir);
      setFolder(dir);
      setFolderFiles(files);
      setSelected(null);
      setResume(null);
      const initial = files.find((f) => f.name === preferredFile) ?? files[0];
      if (initial) {
        setFolderSelected(initial.name);
        await watchHandle(initial.handle);
      } else {
        setFolderSelected(null);
        setWatchedHandle(null);
        setLoaded(null);
      }
      void saveLastOpened({ kind: "directory", handle: dir, fileName: initial?.name });
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

  const restoreLast = useCallback(
    async (record: LastOpened): Promise<boolean> => {
      try {
        if (record.kind === "directory") {
          await openFolder(record.handle as FileSystemDirectoryHandle, record.fileName);
        } else {
          setResume(null);
          await watchHandle(record.handle as FileSystemFileHandle);
        }
        return true;
      } catch {
        return false;
      }
    },
    [openFolder, watchHandle]
  );

  // On load in hosted mode, restore the last opened file/folder. If the browser
  // dropped the read permission, surface a "reopen" button instead (permission
  // requests need a user gesture).
  const [restoreChecked, setRestoreChecked] = useState(false);
  useEffect(() => {
    if (!server.checked || restoreAttempted.current) return;
    restoreAttempted.current = true;
    if (server.connected) {
      setRestoreChecked(true);
      return;
    }
    void (async () => {
      const record = await loadLastOpened();
      if (record) {
        const perm = await record.handle.queryPermission?.({ mode: "read" });
        if (perm === "granted" && (await restoreLast(record))) {
          setRestoreChecked(true);
          return;
        }
        setResume(record);
      }
      setRestoreChecked(true);
    })();
  }, [server.checked, server.connected, restoreLast]);

  const resumeLast = useCallback(async () => {
    if (!resume) return;
    try {
      const perm = resume.handle.requestPermission
        ? await resume.handle.requestPermission({ mode: "read" })
        : "granted";
      if (perm !== "granted") return;
      if (!(await restoreLast(resume))) throw new Error("restore failed");
    } catch {
      // Handle is stale (file moved/deleted); forget it
      setResume(null);
      void clearLastOpened();
    }
  }, [resume, restoreLast]);

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
    if (server.connected && server.files.length > 0 && !selected && !watchedHandle && !folder) {
      void openFile(server.files[0]);
    }
  }, [server, selected, watchedHandle, folder, openFile]);

  // No server (hosted mode): show a bundled demo by default, unless a previous
  // session is being restored (or waiting on the user to reopen it)
  useEffect(() => {
    if (!restoreChecked || resume) return;
    if (server.checked && !server.connected && !loaded && !watchedHandle && !folder && !demoSelected && demos.length > 0) {
      openDemo(demos[0].name);
    }
  }, [restoreChecked, resume, server.checked, server.connected, loaded, watchedHandle, folder, demoSelected, openDemo]);

  // Live reload via SSE (local dev server mode)
  useEffect(() => {
    if (!server.connected) return;
    const source = new EventSource("/api/events");
    source.onmessage = (e) => {
      if (e.data !== "change") return;
      void refresh().then((files) => {
        if (watchedHandle || folder) return;
        if (selected && files.includes(selected)) void openFile(selected);
        else if (files.length > 0) void openFile(files[0]);
      });
    };
    return () => source.close();
  }, [server.connected, selected, watchedHandle, folder, refresh, openFile]);

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
          setResume(null);
          await watchHandle(handle as FileSystemFileHandle);
          void saveLastOpened({ kind: "file", handle: handle as FileSystemFileHandle });
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
        {folder ? (
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
                      void saveLastOpened({ kind: "directory", handle: folder, fileName: f.name });
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
                Open another folder
              </button>
            </div>
          </>
        ) : server.connected ? (
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
        ) : (
          <>
            {demos.length > 0 && (
              <>
                <div className="data-dir">demos</div>
                <ul className="file-list">
                  {demos.map((demo) => (
                    <li key={demo.name}>
                      <button
                        className={demoSelected === demo.name ? "active" : ""}
                        onClick={() => openDemo(demo.name)}
                      >
                        {demo.name}
                      </button>
                    </li>
                  ))}
                </ul>
              </>
            )}
            <div className="offline">
              <p>
                Preview <code>.harness.json</code> files from your machine. Files are read in-browser
                and never uploaded.
              </p>
              {resume && (
                <button className="open-file" onClick={() => void resumeLast()}>
                  Reopen {resume.kind === "directory" ? `${resume.handle.name}/` : resume.handle.name}
                </button>
              )}
              {canPickFiles && (
                <button className="open-file" onClick={() => void pickFile()}>
                  Open harness file
                </button>
              )}
              {canPickFolder && (
                <button className="open-file" onClick={() => void pickFolder()}>
                  Open folder
                </button>
              )}
              <p className="offline-hint">
                {canPickFiles
                  ? "Opened files live-reload as you (or your agent) save them."
                  : "Drop a file anywhere to preview it. For live reload, use Chrome/Edge or run the CLI locally."}
              </p>
              {server.checked && (
                <p className="get-started">
                  New here?{" "}
                  <a
                    href="https://github.com/almond-bot/harness-studio"
                    target="_blank"
                    rel="noreferrer"
                  >
                    Get started
                  </a>
                </p>
              )}
            </div>
          </>
        )}
        {watchedHandle && (
          <div className="watching">
            <span className="live-dot" /> watching {watchedHandle.name}
          </div>
        )}
        <div className="sidebar-footer">
          <button className="link-button" onClick={() => setSettingsOpen(true)}>
            Edit API keys
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
                    {fetchingParts ? "Fetching parts" : `Fetch ${unresolvedParts} part${unresolvedParts > 1 ? "s" : ""}`}
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
          <Preview
            svg={systemDark && loaded.svgDark ? loaded.svgDark : loaded.svg}
            sheetWidth={loaded.sheetWidth!}
            sheetHeight={loaded.sheetHeight!}
          />
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
              {!server.connected && resume && (
                <button className="open-file big" onClick={() => void resumeLast()}>
                  Reopen {resume.kind === "directory" ? `${resume.handle.name}/` : resume.handle.name}
                </button>
              )}
              {!server.connected && canPickFiles && (
                <button className="open-file big" onClick={() => void pickFile()}>
                  Open harness file
                </button>
              )}
              {!server.connected && canPickFolder && (
                <button className="open-file big" onClick={() => void pickFolder()}>
                  Open folder
                </button>
              )}
              {server.checked && !server.connected && (
                <p className="get-started">
                  New here?{" "}
                  <a
                    href="https://github.com/almond-bot/harness-studio"
                    target="_blank"
                    rel="noreferrer"
                  >
                    Get started
                  </a>
                </p>
              )}
            </div>
          )
        )}
      </main>
    </div>
  );
}
