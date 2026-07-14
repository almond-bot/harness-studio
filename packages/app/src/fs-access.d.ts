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
}

interface DataTransferItem {
  getAsFileSystemHandle?: () => Promise<FileSystemHandle | null>;
}
