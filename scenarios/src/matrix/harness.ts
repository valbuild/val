import type {
  PatchId,
  SelectorSource,
  ValConfig,
  ValModule,
} from "@valbuild/core";
import {
  createWorld,
  type PageReaders,
  type PageShow,
  type ServerMode,
  type Studio,
  type World,
} from "../world/createWorld";

/**
 * The content-shape matrix: shape × operation × surface, in memory and fs.
 *
 * One CELL is one operation on one shape. It runs once, in a world of its own
 * (`beforeAll`), and records what every surface shows when the world has
 * settled. Then each surface is its own test, so the matrix says which
 * surface is wrong rather than that something is. A surface that fails today
 * is marked with a reason (`failing`), and runs as `test.failing`, so it
 * turns red the day it is fixed.
 *
 * Every edit is made through the function the product's UI calls for it
 * (`.agent/rules.md`, test rule 3): see each shape's file.
 */

type AnyModule = ValModule<SelectorSource>;

/** Where a surface reads, so a cell can name the surfaces it checks. */
export type Surface =
  /** The Studio's own value at a field (`SourceStore`), as a field reads it. */
  | { kind: "studio"; name: string; module: AnyModule; field: string[] }
  /** The page's server: a loader or server function, read fresh after settling. */
  | {
      kind: "server";
      name: string;
      read: (val: PageReaders) => Promise<unknown>;
    }
  /** The page's client half, through the overlay: a hook's value. */
  | ({ kind: "hook"; name: string } & Omit<PageShow, "surface">)
  /** Anything else, computed after the world settles (bytes served, files on disk). */
  | {
      kind: "after";
      name: string;
      read: (ctx: CellContext) => Promise<unknown>;
    };

export type CellContext = {
  world: World;
  server: ServerMode;
  editor: Studio;
  /** A second editor, for "another editor's change arriving via /stat". */
  other: () => Promise<Studio>;
  /** What the operation wants to keep for its expectations (patch ids, refs). */
  kept: Record<string, string>;
  /** What every surface showed at the end, so far: `after` reads can use it. */
  shown: Record<string, unknown>;
};

export type Cell = {
  operation: string;
  /** The surfaces this cell checks. */
  surfaces: Surface[];
  /** Before the operation: what the world needs (an editor opening a field). */
  before?: (ctx: CellContext) => Promise<void>;
  run: (ctx: CellContext) => Promise<void>;
  /** What each surface should show; a jest asymmetric matcher is fine. */
  expected: (ctx: CellContext) => Record<string, unknown>;
  /** Surfaces that fail today, each with why. */
  failing?: Partial<Record<string, string>>;
  /** Only in one server mode. */
  failingIn?: Partial<Record<ServerMode, Partial<Record<string, string>>>>;
  /** `false` where the chain goes back by design (a discard). */
  neverGoesBack?: boolean;
  /** Only in these modes, with why it does not apply to the others. */
  only?: { modes: ServerMode[]; why: string };
};

export type Shape = {
  name: string;
  config: ValConfig;
  modules: AnyModule[];
  sourceText?: Record<string, string>;
};

/** A failing test's name says why, by the reason's code ("F1: …" → "fails today: F1"). */
function named(title: string, reason: string | undefined): string {
  return reason === undefined
    ? title
    : `${title} (fails today: ${reason.split(":")[0]})`;
}

/** One cell's run: what each surface showed, and whether the frames went back. */
type CellResult = {
  shown: Record<string, unknown>;
  expected: Record<string, unknown>;
  wentBack: string | null;
  errors: string[];
  failure: Error | null;
};

async function runCell(
  server: ServerMode,
  shape: Shape,
  cell: Cell,
): Promise<CellResult> {
  const world = await createWorld({
    config: shape.config,
    modules: shape.modules,
    server,
    ...(shape.sourceText !== undefined ? { sourceText: shape.sourceText } : {}),
  });
  const shown: Record<string, unknown> = {};
  let otherStudio: Studio | null = null;
  try {
    const editor = await world.studio("editor");
    const ctx: CellContext = {
      world,
      server,
      editor,
      other: async () => (otherStudio ??= await world.studio("other")),
      kept: {},
      shown,
    };
    for (const surface of cell.surfaces) {
      if (surface.kind === "studio") {
        editor.reads(surface.name, surface.module, surface.field);
      }
    }
    const serverSurfaces = cell.surfaces.filter(
      (s): s is Extract<Surface, { kind: "server" }> => s.kind === "server",
    );
    const page = world.page("/", { draftMode: true });
    for (const surface of serverSurfaces)
      page.reads(surface.name, surface.read);
    const hooks = cell.surfaces.filter(
      (s): s is Extract<Surface, { kind: "hook" }> => s.kind === "hook",
    );
    const loaded = await world.loadPage("/", {
      shows: hooks.map(({ kind: _kind, name, ...show }) => ({
        surface: name,
        ...show,
      })),
    });
    await world.observe();
    await cell.before?.(ctx);
    await world.settle();
    await world.observe();
    await cell.run(ctx);
    await world.settle();
    await world.observe();
    for (const surface of cell.surfaces) {
      if (surface.kind !== "after")
        shown[surface.name] = world.frames.last(surface.name);
    }
    for (const surface of cell.surfaces) {
      if (surface.kind === "after")
        shown[surface.name] = await surface.read(ctx);
    }
    let wentBack: string | null = null;
    try {
      world.frames.expectNeverGoesBack();
    } catch (error) {
      wentBack = error instanceof Error ? error.message : String(error);
    }
    return {
      shown,
      expected: cell.expected(ctx),
      wentBack,
      errors: [...editor.errors(), ...loaded.studio.errors()],
      failure: null,
    };
  } catch (error) {
    return {
      shown,
      expected: {},
      wentBack: null,
      errors: [],
      failure: error instanceof Error ? error : new Error(String(error)),
    };
  } finally {
    await world.dispose();
  }
}

/** The matrix for one shape: every cell, in memory and fs. */
export function matrix(shape: Shape, cells: Cell[]): void {
  describe.each<ServerMode>(["memory", "fs"])(
    `M ${shape.name} on %s`,
    (server) => {
      for (const cell of cells) {
        if (cell.only !== undefined && !cell.only.modes.includes(server))
          continue;
        describe(cell.operation, () => {
          let result: CellResult = {
            shown: {},
            expected: {},
            wentBack: null,
            errors: [],
            failure: new Error("the cell did not run"),
          };
          beforeAll(async () => {
            result = await runCell(server, shape, cell);
          }, 120_000);
          for (const surface of cell.surfaces) {
            const reason =
              cell.failingIn?.[server]?.[surface.name] ??
              cell.failing?.[surface.name];
            (reason !== undefined ? test.failing : test)(
              named(
                `M ${shape.name} · ${cell.operation} · ${surface.name}`,
                reason,
              ),
              () => {
                if (result.failure !== null) throw result.failure;
                expect({ [surface.name]: result.shown[surface.name] }).toEqual({
                  [surface.name]: result.expected[surface.name],
                });
              },
            );
          }
          const goesBackReason =
            cell.failingIn?.[server]?.["never goes back"] ??
            cell.failing?.["never goes back"];
          if (cell.neverGoesBack !== false) {
            (goesBackReason !== undefined ? test.failing : test)(
              named(
                `M ${shape.name} · ${cell.operation} · never goes back`,
                goesBackReason,
              ),
              () => {
                if (result.failure !== null) throw result.failure;
                expect(result.wentBack).toBeNull();
              },
            );
          }
          const errorsReason =
            cell.failingIn?.[server]?.["no errors shown"] ??
            cell.failing?.["no errors shown"];
          (errorsReason !== undefined ? test.failing : test)(
            named(
              `M ${shape.name} · ${cell.operation} · no errors shown`,
              errorsReason,
            ),
            () => {
              if (result.failure !== null) throw result.failure;
              expect(result.errors).toEqual([]);
            },
          );
        });
      }
    },
  );
}

/** A field of a value read through a reader. */
export function fieldOf(read: unknown, field: string[]): unknown {
  let value = read;
  for (const key of field) {
    value =
      typeof value === "object" && value !== null
        ? Object.entries(value).find(([k]) => k === key)?.[1]
        : undefined;
  }
  return value;
}

/** The keys of a record a reader gave back, sorted; `undefined` when it is not one. */
export function keysOf(read: unknown): string[] | undefined {
  return typeof read === "object" && read !== null && !Array.isArray(read)
    ? Object.keys(read).sort()
    : undefined;
}

/** A kept value, or a failure naming what is missing. */
export function kept(ctx: CellContext, name: string): string {
  const value = ctx.kept[name];
  if (value === undefined) throw new Error(`nothing kept as "${name}"`);
  return value;
}

export type { PatchId };
