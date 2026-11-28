import type { ModuleFilePath } from "@valbuild/core";
import type { JSONValue } from "@valbuild/core/patch";
import { writeContent, writeEntries } from "./merge";
import {
  loadProject,
  projectOf,
  type Files,
  type Project,
  type ProjectModule,
} from "./project";

/**
 * Content written back into a project's files: each module's content as it is
 * recorded, written into its `.val.ts` (and a `.jsonValues()` record's
 * `.val.json` entries) the way a save writes them.
 *
 * What connecting a project that has history needs (valbuild/home,
 * `docs/plans/connect-with-history.md`, phase 6a). A project Val Build hosts
 * keeps its content as each module's Source, never as file text: its
 * `.val.ts` files still hold what the project was made with. Before its code
 * can go into a repository, the content has to be in the files.
 *
 * The same writer a merge uses (`writeContent`, `writeEntries`): the smallest
 * patch, through the AST operations a save uses, so the code around the
 * content -- imports, comments, formatting, the schema -- is left exactly as
 * it was. Then the project is loaded again, and every module must read back
 * as exactly what was recorded, key order too. A module whose targeted write
 * does not read back is written whole; one that still does not -- content its
 * code computes rather than holds, say -- is refused by name. Nothing is
 * guessed.
 */

export type FoldRefusal = {
  /** The module, or `null` when the written project as a whole would not load. */
  module: ModuleFilePath | null;
  /** Why, in a developer's words. */
  reason: string;
};

export type FoldResult =
  | {
      status: "folded";
      /** The whole project, with the content written in. */
      files: Files;
      /** The files that changed, by path; a removed `.val.json` entry too. */
      changed: string[];
    }
  | { status: "refused"; refusals: FoldRefusal[] };

export async function foldContent(input: {
  /** The project's files: its code, as the live build has it. */
  files: Files;
  /** Each module's content as recorded. A module left out is not touched. */
  content: Record<ModuleFilePath, JSONValue>;
}): Promise<FoldResult> {
  const { files, content } = input;
  const ids = (Object.keys(content) as ModuleFilePath[]).sort();
  let project: Project;
  try {
    project = projectOf(files, await loadProject(files));
  } catch (error) {
    return refusedWhole(`The project's own files could not be loaded`, error);
  }

  const refusals: FoldRefusal[] = [];
  for (const id of ids) {
    if (project.modules[id] === undefined || files[id.slice(1)] == null) {
      refusals.push({
        module: id,
        reason: `The project's code has no module ${id}, so its content has nowhere to be written.`,
      });
    }
  }
  if (refusals.length > 0) return { status: "refused", refusals };

  // First, the smallest patch for every module whose content changed. One
  // that did not is not written at all: even a write of nothing re-prints a
  // `.jsonValues()` module's `.val.ts`, which can change its code.
  const changedIds = ids.filter(
    (id) =>
      JSON.stringify(project.modules[id]?.source) !==
      JSON.stringify(content[id]),
  );
  const targeted = write(project, changedIds, content, "targeted");
  if (targeted.status === "refused") return targeted;
  let written = targeted.files;
  let wrong = await readsBackWrong(written, ids, content);
  if ("refused" in wrong) return wrong.refused;

  // Then, whole, what did not read back: a record in another order, which
  // the smallest patch does not see as a change.
  if (wrong.modules.length > 0) {
    const retried: Files = { ...written };
    const whole = write(
      { ...project, files: retried },
      wrong.modules,
      content,
      "whole",
    );
    if (whole.status === "refused") return whole;
    written = { ...retried, ...whole.files };
    wrong = await readsBackWrong(written, ids, content);
    if ("refused" in wrong) return wrong.refused;
    if (wrong.modules.length > 0) {
      return {
        status: "refused",
        refusals: wrong.modules.map((id) => ({
          module: id,
          reason: isJsonValues(project.modules[id])
            ? `Its entries were written into their .val.json files, but ${id.slice(1)} lists them in another order than the one recorded. Reordering a .jsonValues() record's entries is not written yet.`
            : `Its content was written into ${id.slice(1)}, but the file reads back as something else. Its code computes its content rather than holding it, so it cannot be written back.`,
        })),
      };
    }
  }

  const tree: Files = {};
  const changed: string[] = [];
  for (const file of new Set([
    ...Object.keys(files),
    ...Object.keys(written),
  ])) {
    const before = files[file] ?? null;
    const after = file in written ? written[file] : before;
    if (after !== before) changed.push(file);
    if (after !== null) tree[file] = after;
  }
  return { status: "folded", files: tree, changed: changed.sort() };
}

/**
 * Writes each module's recorded content into its files. `targeted`: the
 * smallest patch from what the file holds. `whole`: the content argument
 * written whole, for a module whose smallest patch did not read back.
 */
function write(
  project: Project,
  ids: ModuleFilePath[],
  content: Record<ModuleFilePath, JSONValue>,
  how: "targeted" | "whole",
):
  | { status: "written"; files: Files }
  | Extract<FoldResult, { status: "refused" }> {
  const files: Files = { ...project.files };
  const refusals: FoldRefusal[] = [];
  for (const id of ids) {
    const module = project.modules[id];
    const file = id.slice(1);
    const text = files[file];
    if (module === undefined || text == null) continue;
    try {
      if (isJsonValues(module)) {
        if (content[id] === null) {
          // A nullable record recorded as null: the content argument is
          // null, and its entries' files go.
          files[file] = writeContent(file, text, module.source, null);
          for (const entry of Object.values(module.entries ?? {})) {
            files[entry] = null;
          }
        } else {
          Object.assign(
            files,
            writeEntries(
              file,
              text,
              // `whole`: every entry's file written anew, in the recorded
              // order of its fields -- the smallest patch keeps a file whose
              // content is the same in another order.
              how === "whole" ? {} : files,
              // An empty record has no entries yet: the first is added as a
              // `c.json(...)` line and a file of its own, as a save adds it.
              module.entries ?? {},
              // `whole` runs on what `targeted` wrote, which already names
              // the recorded entries.
              how === "whole" ? content[id] : module.source,
              content[id],
              [],
            ),
          );
        }
      } else {
        files[file] = writeContent(
          file,
          text,
          how === "targeted" ? module.source : undefined,
          content[id],
        );
      }
    } catch (error) {
      refusals.push({
        module: id,
        reason: `Its content could not be written into ${file}: ${messageOf(error)}`,
      });
    }
  }
  return refusals.length > 0
    ? { status: "refused", refusals }
    : { status: "written", files };
}

/** The modules whose written files do not read back as exactly what was recorded. */
async function readsBackWrong(
  files: Files,
  ids: ModuleFilePath[],
  content: Record<ModuleFilePath, JSONValue>,
): Promise<
  | { modules: ModuleFilePath[] }
  | { refused: Extract<FoldResult, { status: "refused" }> }
> {
  let reloaded: Awaited<ReturnType<typeof loadProject>>;
  try {
    reloaded = await loadProject(files);
  } catch (error) {
    return {
      refused: refusedWhole(
        "The project could not be loaded with the content written in",
        error,
      ),
    };
  }
  return {
    modules: ids.filter(
      (id) =>
        // Key order counts: a record's order is the editor's.
        JSON.stringify(reloaded.modules[id]?.source) !==
        JSON.stringify(content[id]),
    ),
  };
}

function refusedWhole(
  what: string,
  error: unknown,
): Extract<FoldResult, { status: "refused" }> {
  return {
    status: "refused",
    refusals: [{ module: null, reason: `${what}: ${messageOf(error)}` }],
  };
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * A `.jsonValues()` record, by its schema: its content lives in `.val.json`
 * entries, also while it has none yet (and so no entry files to tell it by).
 */
function isJsonValues(module: ProjectModule | undefined): boolean {
  const schema = module?.schema;
  return (
    schema !== undefined &&
    schema.type === "record" &&
    "jsonValues" in schema &&
    schema.jsonValues === true
  );
}
