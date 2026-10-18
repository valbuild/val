import type { PatchId } from "@valbuild/core";
import {
  InMemoryPatchStore,
  type StoredFile,
  type StoredPatch,
  type ValPatchStore,
} from "../ValOpsMemory";

/** The part of `Storage` this needs, so a test can hand it a map. */
export type PatchStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;

/** Where the demo keeps its edits. One key: the chain is one list. */
export const DEMO_PATCHES_STORAGE_KEY = "val-demo:patches";

/**
 * A {@link ValPatchStore} that survives a reload of the tab.
 *
 * The demo's store. `sessionStorage` is per tab, which is the point: a fresh
 * tab is a fresh demo, and a reload is not a lost edit.
 *
 * Only the PATCHES are written down. Files stay in memory, as in
 * {@link InMemoryPatchStore} -- the demo does not upload, and bytes in
 * `sessionStorage` would hit its quota on the first photo.
 *
 * Order is the contract, as for every store: the list is written whole, in
 * order, on every change. A stored value that cannot be read is treated as no
 * edits rather than as an error -- this is a demo's scratch space, and the
 * alternative is a Studio that cannot start because of an old tab.
 */
export class SessionStoragePatchStore implements ValPatchStore {
  private readonly memory = new InMemoryPatchStore();
  private readonly loaded: Promise<void>;

  constructor(
    private readonly storage: PatchStorage,
    private readonly key: string = DEMO_PATCHES_STORAGE_KEY,
  ) {
    this.loaded = this.load();
  }

  private async load(): Promise<void> {
    for (const patch of this.read()) {
      await this.memory.append(patch);
    }
  }

  private read(): StoredPatch[] {
    try {
      const raw = this.storage.getItem(this.key);
      if (raw === null) return [];
      const parsed: unknown = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed.filter(isStoredPatch) : [];
    } catch {
      return [];
    }
  }

  private async write(): Promise<void> {
    const patches: StoredPatch[] = [];
    for (const patchId of await this.memory.list()) {
      const patch = await this.memory.get(patchId);
      if (patch) patches.push(patch);
    }
    try {
      if (patches.length === 0) {
        this.storage.removeItem(this.key);
      } else {
        this.storage.setItem(this.key, JSON.stringify(patches));
      }
    } catch {
      // Full or unavailable: the edit still holds for the life of the tab.
    }
  }

  async list(): Promise<PatchId[]> {
    await this.loaded;
    return this.memory.list();
  }

  async get(patchId: PatchId): Promise<StoredPatch | null> {
    await this.loaded;
    return this.memory.get(patchId);
  }

  async append(patch: StoredPatch): Promise<void> {
    await this.loaded;
    await this.memory.append(patch);
    await this.write();
  }

  async delete(patchIds: PatchId[]): Promise<void> {
    await this.loaded;
    await this.memory.delete(patchIds);
    await this.write();
  }

  putFile(file: StoredFile): Promise<void> {
    return this.memory.putFile(file);
  }

  getFile(patchId: PatchId, filePath: string): Promise<StoredFile | null> {
    return this.memory.getFile(patchId, filePath);
  }

  deleteFile(patchId: PatchId, filePath: string): Promise<void> {
    return this.memory.deleteFile(patchId, filePath);
  }

  filesOf(patchId: PatchId): Promise<StoredFile[]> {
    return this.memory.filesOf(patchId);
  }
}

function isStoredPatch(value: unknown): value is StoredPatch {
  return (
    typeof value === "object" &&
    value !== null &&
    "patchId" in value &&
    typeof value.patchId === "string" &&
    "path" in value &&
    typeof value.path === "string" &&
    "patch" in value &&
    Array.isArray(value.patch)
  );
}

/**
 * The demo's store: this tab's `sessionStorage`, or memory where the browser
 * will not give us that (site data blocked, some private modes). Reading the
 * property can throw, so it is asked here once rather than at every use.
 */
export function createDemoPatchStore(): ValPatchStore {
  try {
    return new SessionStoragePatchStore(window.sessionStorage);
  } catch {
    return new InMemoryPatchStore();
  }
}

/** Forgets the demo's edits. The next load starts from the published content. */
export function resetDemoPatches(): void {
  try {
    window.sessionStorage.removeItem(DEMO_PATCHES_STORAGE_KEY);
  } catch {
    // Nothing stored, or nowhere to store it: nothing to forget.
  }
}
