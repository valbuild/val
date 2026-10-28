import type { SketchpadSummaryT, SketchpadT } from "@valbuild/shared/internal";

/**
 * Where a project's sketchpads are kept, in each of the server's modes:
 * `.val/sketchpads` in `fs` mode, the content service in `http` mode, the
 * tab's memory in the demo. See `Sketchpad` in `ApiRoutes.ts` for what one
 * is.
 *
 * The store keeps what it is given. Whether a text is a sketch at all is
 * decided before it gets here (`checkSketch`, in `ValServer`), once for every
 * mode, so no store has its own idea of the format.
 */
export interface SketchpadStore {
  list(filter: SketchpadFilter): Promise<SketchpadSummaryT[]>;
  get(id: string): Promise<SketchpadT | null>;
  create(input: SketchpadInput): Promise<SketchpadT>;
  /**
   * Applies `change` if the sketchpad is still at `change.baseVersion`, in
   * one step: a store that checked and then wrote would let two writers in
   * between.
   */
  update(id: string, change: SketchpadChange): Promise<SketchpadUpdate>;
}

export type SketchpadFilter = {
  archived: "exclude" | "include" | "only";
  page?: string;
};

export type SketchpadInput = {
  text: string;
  title: string | null;
  page: string | null;
  /** Profile id of whoever made it, when somebody is signed in. */
  by: string | null;
};

export type SketchpadChange = {
  baseVersion: number;
  text?: string;
  title?: string | null;
  page?: string | null;
  archived?: boolean;
  by: string | null;
};

export type SketchpadUpdate =
  | { status: "updated"; sketchpad: SketchpadT }
  | { status: "not-found" }
  /** Changed since `baseVersion`; `sketchpad` is how it is now. */
  | { status: "conflict"; sketchpad: SketchpadT };

/**
 * Whether `id` is in the shape a sketchpad's id has. Every store checks it
 * before the id goes anywhere it could mean something else: a file name in
 * fs mode, a URL path in http mode, where `..` is not an id but a way out.
 */
export function isSketchpadId(id: string): boolean {
  return /^[0-9a-f-]{36}$/.test(id);
}

/**
 * A random id in the shape of a UUID. `getRandomValues` rather than
 * `randomUUID`, which a browser only has in a secure context -- and the demo
 * runs this server in the visitor's tab.
 */
export function newSketchpadId(): string {
  const bytes = new Uint8Array(16);
  globalThis.crypto.getRandomValues(bytes);
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, "0"));
  return [
    hex.slice(0, 4).join(""),
    hex.slice(4, 6).join(""),
    hex.slice(6, 8).join(""),
    hex.slice(8, 10).join(""),
    hex.slice(10, 16).join(""),
  ].join("-");
}

export function summaryOf(sketchpad: SketchpadT): SketchpadSummaryT {
  const { text, ...summary } = sketchpad;
  void text;
  return summary;
}

export function matchesFilter(
  sketchpad: SketchpadSummaryT,
  filter: SketchpadFilter,
): boolean {
  if (filter.page !== undefined && sketchpad.page !== filter.page) {
    return false;
  }
  return filter.archived === "include"
    ? true
    : filter.archived === "only"
      ? sketchpad.archived
      : !sketchpad.archived;
}

/** Newest change first, as every list of them is read. */
export function byUpdatedAt(a: SketchpadSummaryT, b: SketchpadSummaryT) {
  return b.updatedAt.localeCompare(a.updatedAt);
}

export function newSketchpad(input: SketchpadInput, now: Date): SketchpadT {
  const at = now.toISOString();
  return {
    id: newSketchpadId(),
    page: input.page,
    title: input.title,
    text: input.text,
    version: 1,
    archived: false,
    createdAt: at,
    updatedAt: at,
    createdBy: input.by,
    updatedBy: input.by,
  };
}

/** `current` with `change` applied, or why not. Pure: storing is the caller's. */
export function applySketchpadChange(
  current: SketchpadT | null,
  change: SketchpadChange,
  now: Date,
): SketchpadUpdate {
  if (current === null) {
    return { status: "not-found" };
  }
  if (current.version !== change.baseVersion) {
    return { status: "conflict", sketchpad: current };
  }
  return {
    status: "updated",
    sketchpad: {
      ...current,
      ...(change.text !== undefined ? { text: change.text } : {}),
      ...(change.title !== undefined ? { title: change.title } : {}),
      ...(change.page !== undefined ? { page: change.page } : {}),
      ...(change.archived !== undefined ? { archived: change.archived } : {}),
      version: current.version + 1,
      updatedAt: now.toISOString(),
      updatedBy: change.by,
    },
  };
}

/**
 * Sketchpads kept in memory, for as long as the server runs: the demo's
 * store, where a reload starts over anyway, and the tests'.
 */
export function createMemorySketchpadStore(
  now: () => Date = () => new Date(),
): SketchpadStore {
  const sketchpads = new Map<string, SketchpadT>();
  return {
    async list(filter) {
      return Array.from(sketchpads.values())
        .map(summaryOf)
        .filter((sketchpad) => matchesFilter(sketchpad, filter))
        .sort(byUpdatedAt);
    },
    async get(id) {
      return sketchpads.get(id) ?? null;
    },
    async create(input) {
      const sketchpad = newSketchpad(input, now());
      sketchpads.set(sketchpad.id, sketchpad);
      return sketchpad;
    },
    async update(id, change) {
      // Synchronous from the read to the write, so nothing interleaves.
      const result = applySketchpadChange(
        sketchpads.get(id) ?? null,
        change,
        now(),
      );
      if (result.status === "updated") {
        sketchpads.set(id, result.sketchpad);
      }
      return result;
    },
  };
}
