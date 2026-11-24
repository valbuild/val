import type { ModuleFilePath, PatchId } from "@valbuild/core";
import type { Patch } from "@valbuild/shared/internal";
import type { AuthorId, BaseSha, MetadataOfType } from "./ValOps";

/*
 * Where memory mode keeps pending patches, apart from `ValOpsMemory` itself:
 * a host constructs an `InMemoryPatchStore` at module scope (to hand the
 * SAME store to `initValServer` and `initValContent`), and that must not
 * evaluate the data layer -- TypeScript, sucrase, the Studio -- on a site
 * that only ever serves published pages.
 */
/**
 * One stored patch. Everything the ordered chain needs and nothing else.
 */
export type StoredPatch = {
  patchId: PatchId;
  path: ModuleFilePath;
  patch: Patch;
  authorId: AuthorId | null;
  createdAt: string;
  baseSha: BaseSha;
};

/**
 * One pending binary file: an upload that has not been published yet.
 *
 * Keyed by the patch that carries it, exactly as `fs` mode keys the directory
 * it writes to. The patch's own `file` op holds a hash, not the bytes, so these
 * arrive on their own request and are joined up by `(patchId, filePath)`.
 */
export type StoredFile = {
  patchId: PatchId;
  /**
   * Where the file will live once published.
   *
   * For a LOCAL file that is `/public/val/photo.jpg`. For a REMOTE one it is
   * the path INSIDE the ref, not the ref itself -- `splitRemoteRef` has already
   * taken it apart by the time the bytes get here, and both readers are keyed
   * the same way. This is why neither takes `remote` into account: the caller
   * has resolved that before it asks.
   */
  filePath: string;
  data: Uint8Array;
  metadata: MetadataOfType<"file" | "image"> | undefined;
};

/**
 * Where pending patches live.
 *
 * The point of the interface: `ValOpsMemory` is not tied to memory. The default
 * implementation below is explicitly NOT durable -- it dies with the process,
 * or in a Worker with the isolate -- and a durable one (a Durable Object, whose
 * single-threaded execution is the lock Val's fs store builds out of a file)
 * is a swap rather than a rewrite.
 *
 * ORDER IS THE CONTRACT. `list()` returns patch ids in the order they were
 * written, and that order is the chain: entry i's parent is entry i-1. This is
 * the same decision `ValOpsFS` makes with `patches.log` -- the server decides
 * where a patch goes, and it goes last -- and it exists for the same reason: an
 * order held in the patches themselves lets a client working from a stale view
 * strand every patch behind a parent that never landed.
 */
export interface ValPatchStore {
  list(): Promise<PatchId[]>;
  get(patchId: PatchId): Promise<StoredPatch | null>;
  append(patch: StoredPatch): Promise<void>;
  /** The patches AND every file they carry. */
  delete(patchIds: PatchId[]): Promise<void>;

  /**
   * Hold an uploaded file until its patch is published or dropped.
   *
   * Uploads arrive BEFORE the patch record does -- the record's `file` op
   * carries only a hash, so it would otherwise point at nothing. So a file for
   * a patch id that does not exist yet is normal and must be accepted. `fs`
   * mode stages these outside its store and moves them in when the record
   * lands, because a directory of files with no `patch.json` is indistinguishable
   * from a patch whose contents were lost, and its repair pass deletes those.
   * Nothing sweeps this store, so the two-step is not needed here -- at the cost
   * that bytes uploaded for a patch that is never recorded stay until the store
   * is dropped.
   */
  putFile(file: StoredFile): Promise<void>;
  getFile(patchId: PatchId, filePath: string): Promise<StoredFile | null>;
  deleteFile(patchId: PatchId, filePath: string): Promise<void>;
  /** Every file held for a patch, which is what the publish step uploads. */
  filesOf(patchId: PatchId): Promise<StoredFile[]>;
}

/** The default store. Not durable, deliberately and visibly. */
export class InMemoryPatchStore implements ValPatchStore {
  private readonly order: PatchId[] = [];
  private readonly byId = new Map<PatchId, StoredPatch>();

  async list(): Promise<PatchId[]> {
    return [...this.order];
  }

  async get(patchId: PatchId): Promise<StoredPatch | null> {
    return this.byId.get(patchId) ?? null;
  }

  async append(patch: StoredPatch): Promise<void> {
    if (!this.byId.has(patch.patchId)) {
      this.order.push(patch.patchId);
    }
    this.byId.set(patch.patchId, patch);
  }

  async delete(patchIds: PatchId[]): Promise<void> {
    for (const patchId of patchIds) {
      const at = this.order.indexOf(patchId);
      if (at !== -1) {
        this.order.splice(at, 1);
      }
      this.byId.delete(patchId);
      // The bytes go with the patch. They are only reachable through it, so
      // keeping them would be a leak with no reader -- and these are images.
      for (const key of this.files.keys()) {
        if (key.startsWith(`${patchId}\u0000`)) {
          this.files.delete(key);
        }
      }
    }
  }

  /*
   * `\u0000` cannot occur in a patch id or a path, so the two halves of the key
   * can never run together into a different pair.
   *
   * The PATH is normalised for the same reason `sourceFiles` is, and it is not
   * cosmetic: an upload arrives as `/public/val/x.png`, and the publish step
   * looks the same file up as `public/val/x.png` because that is what
   * `splitRemoteRef` yields from a remote ref. `ValOpsFS` never noticed --
   * `path.join` collapses the difference -- so this is another thing a
   * filesystem was doing for free. Without it a remote image uploads fine,
   * patches fine, and fails at publish with "No bytes held", naming a ref whose
   * bytes are sitting right there under the other spelling.
   */
  private static fileKey(patchId: PatchId, filePath: string): string {
    return `${patchId}\u0000${filePath.replace(/^\//, "")}`;
  }
  private readonly files = new Map<string, StoredFile>();

  async putFile(file: StoredFile): Promise<void> {
    this.files.set(
      InMemoryPatchStore.fileKey(file.patchId, file.filePath),
      file,
    );
  }

  async getFile(
    patchId: PatchId,
    filePath: string,
  ): Promise<StoredFile | null> {
    return (
      this.files.get(InMemoryPatchStore.fileKey(patchId, filePath)) ?? null
    );
  }

  async deleteFile(patchId: PatchId, filePath: string): Promise<void> {
    this.files.delete(InMemoryPatchStore.fileKey(patchId, filePath));
  }

  async filesOf(patchId: PatchId): Promise<StoredFile[]> {
    return [...this.files.values()].filter((file) => file.patchId === patchId);
  }
}
