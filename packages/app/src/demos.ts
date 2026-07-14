import { parseHarnessText, type LoadedHarness } from "./useHarness";

// Example harnesses baked into the static build so the hosted viewer has
// something to show before the user opens their own files.
const modules = import.meta.glob("../../../examples/*.harness.json", {
  eager: true,
  import: "default",
}) as Record<string, unknown>;

export interface Demo {
  name: string;
  load: () => LoadedHarness;
}

export const demos: Demo[] = Object.entries(modules)
  .map(([path, data]) => {
    const name = path.split("/").pop()!;
    return { name, load: () => parseHarnessText(name, JSON.stringify(data)) };
  })
  .sort((a, b) => a.name.localeCompare(b.name));
