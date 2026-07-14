// File System Access API surface not yet in TypeScript's DOM lib (Chromium-only)
interface OpenFilePickerType {
  description?: string;
  accept: Record<string, string[]>;
}

interface Window {
  showOpenFilePicker?: (options?: {
    types?: OpenFilePickerType[];
    multiple?: boolean;
  }) => Promise<FileSystemFileHandle[]>;
  showDirectoryPicker?: (options?: { mode?: "read" | "readwrite" }) => Promise<FileSystemDirectoryHandle>;
}

interface FileSystemDirectoryHandle {
  values(): AsyncIterableIterator<FileSystemHandle>;
}

interface FileSystemHandle {
  queryPermission?(descriptor?: { mode?: "read" | "readwrite" }): Promise<PermissionState>;
  requestPermission?(descriptor?: { mode?: "read" | "readwrite" }): Promise<PermissionState>;
}

interface DataTransferItem {
  getAsFileSystemHandle?: () => Promise<FileSystemHandle | null>;
}
