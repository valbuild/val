import {
  Internal,
  type ModuleFilePath,
  type SerializedSchema,
} from "@valbuild/core";
import { navNodeId } from "../compare/toCompareStructure";
import { buildDataTree, type ChangedModule } from "../compare/navTree";
import type {
  CompareChangeKind,
  CompareNavNode,
  CompareNavSection,
  CompareSide,
} from "../compare/types";
import type { Profile } from "../components/ValProvider";
import {
  diffSource,
  recordEntryChanges,
  type DiffOptions,
} from "../diff/diffSource";
import type { FieldDiff } from "../diff/types";
import { isPageModule } from "../utils/pageRoutes";
import { prettyModuleLocation } from "../utils/prettyModulePath";
import { isPathWithin } from "../utils/sourcePath";
import type {
  ReviewAffectedPages,
  ReviewCode,
  ReviewPageModel,
  ReviewPane,
  ReviewRow,
} from "./types";

/**
 * Review's model, from what the Studio holds: each module's schema, and its
 * Source on the two sides being compared.
 *
 * The same function on the site and in a proposal, which is the point of
 * diffing Sources. On the site the two sides are what is published and what
 * is pending; in a proposal they are the site and the proposal. Nothing here
 * knows which, so the two Reviews cannot drift apart.
 *
 * ## A page is the unit, not the module it lives in
 *
 * A router module is one module holding many pages, so its changes are filed
 * by page: a page added, removed, moved to another address, or edited. Every
 * other module is one pane. The rule `toCompareStructure` states, kept.
 *
 * Pure, so what the nav lists and what a pane holds are tested without a
 * store. `useReviewPageModel` gathers the inputs.
 */
export type ReviewModuleInput = {
  moduleFilePath: ModuleFilePath;
  schema: SerializedSchema | undefined;
  /** Its Source on the left. Undefined: the module is not there. */
  before: unknown;
  /** Its Source on the right. */
  after: unknown;
};

export type ReviewPageModelInput = {
  modules: ReviewModuleInput[];
  left: CompareSide;
  right: CompareSide;
  profiles: Record<string, Profile>;
  /**
   * The pending edits, as paths with their authors: who a change is by. A
   * change no pending edit explains has no author here: in a proposal, one
   * that was already saved.
   */
  edits?: ReviewEdit[];
  /** Passed to the diff: where a picture's bytes are served. */
  mediaUrl?: DiffOptions["mediaUrl"];
  code?: ReviewCode;
  affected?: ReviewAffectedPages;
};

/** One pending edit: where it was made, and by whom. */
export type ReviewEdit = {
  sourcePath: string;
  authorIds: string[];
};

export function toReviewPageModel(
  input: ReviewPageModelInput,
): ReviewPageModel {
  const panes: Record<string, ReviewPane> = {};
  const pageNodes: CompareNavNode[] = [];
  const dataModules: ChangedModule[] = [];
  const options: DiffOptions = {
    ...(input.mediaUrl ? { mediaUrl: input.mediaUrl } : {}),
  };
  const rowsOf = (fields: FieldDiff[]): ReviewRow[] =>
    fields.map((field) => ({
      ...field,
      authorIds: authorsOf(field.id, input.edits ?? []),
    }));

  for (const module of input.modules) {
    const { moduleFilePath, schema } = module;
    if (schema?.type === "record" && isPageModule(schema)) {
      for (const entry of recordEntryChanges(module.before, module.after)) {
        if (entry.change === "unchanged") continue;
        const route = entry.key;
        const pagePath = Internal.joinModuleFilePathAndModulePath(
          moduleFilePath,
          Internal.patchPathToModulePath([route]),
        );
        const rows = rowsOf(
          diffSource(
            {
              moduleFilePath,
              schema: schema.item,
              before: entry.before,
              after: entry.after,
              path: [route],
            },
            options,
          ),
        );
        const change = PAGE_CHANGE[entry.change];
        const id = navNodeId(pagePath);
        panes[id] = {
          sourcePath: pagePath,
          // Unnamed, a page is called its route, and has no second line.
          title: route,
          change,
          ...(entry.renamedFrom !== undefined
            ? { renamedFrom: entry.renamedFrom }
            : {}),
          pageUrl: route,
          rows,
        };
        pageNodes.push({
          id,
          label: route,
          kind: "page",
          change,
          ...(entry.renamedFrom !== undefined
            ? { renamedFrom: entry.renamedFrom }
            : {}),
          changedCount: rows.length,
          ...authorIdsOf(rows),
        });
      }
      continue;
    }

    const rows = rowsOf(
      diffSource(
        { moduleFilePath, schema, before: module.before, after: module.after },
        options,
      ),
    );
    if (rows.length === 0) continue;
    const change: CompareChangeKind =
      module.before === undefined
        ? "added"
        : module.after === undefined
          ? "removed"
          : "changed";
    const id = navNodeId(moduleFilePath);
    const location = prettyModuleLocation(moduleFilePath);
    panes[id] = {
      sourcePath: moduleFilePath,
      title: moduleName(moduleFilePath),
      ...(location !== null ? { location } : {}),
      change,
      rows,
    };
    dataModules.push({
      moduleFilePath,
      node: { id, change, changedCount: rows.length, ...authorIdsOf(rows) },
    });
  }

  const sections: CompareNavSection[] = [];
  if (pageNodes.length > 0) {
    sections.push({ id: "pages", title: "Pages", nodes: pageNodes });
  }
  if (dataModules.length > 0) {
    sections.push({
      id: "data",
      title: "Data",
      nodes: buildDataTree(dataModules),
    });
  }
  return {
    left: input.left,
    right: input.right,
    changeCount: Object.values(panes).reduce(
      (sum, pane) => sum + pane.rows.length,
      0,
    ),
    sections,
    panes,
    profiles: input.profiles,
    ...(input.code !== undefined ? { code: input.code } : {}),
    ...(input.affected !== undefined ? { affected: input.affected } : {}),
  };
}

const PAGE_CHANGE: Record<
  "added" | "removed" | "changed" | "renamed",
  CompareChangeKind
> = {
  added: "added",
  removed: "removed",
  changed: "changed",
  // A page under a new key is a page at a new address.
  renamed: "moved",
};

/**
 * Who made a change: everyone with a pending edit at it, inside it or around
 * it. Inside, because a row for a list stands for edits to its items; around,
 * because an entry added whole is one edit and many rows.
 */
function authorsOf(rowId: string, edits: ReviewEdit[]): string[] {
  // A row for something that is gone is named by where it was.
  const path = rowId.split("@before")[0].split("#")[0];
  const authors = new Set<string>();
  for (const edit of edits) {
    if (
      isPathWithin(edit.sourcePath, path) ||
      isPathWithin(path, edit.sourcePath)
    ) {
      for (const id of edit.authorIds) authors.add(id);
    }
  }
  return [...authors];
}

function authorIdsOf(rows: ReviewRow[]): { authorIds?: string[] } {
  const ids = new Set(rows.flatMap((row) => row.authorIds));
  return ids.size > 0 ? { authorIds: [...ids] } : {};
}

/** `/content/authors.val.ts` is called `authors`. */
function moduleName(moduleFilePath: string): string {
  const file = moduleFilePath.slice(moduleFilePath.lastIndexOf("/") + 1);
  return file.replace(/\.val\.[jt]sx?$/, "");
}

/**
 * The model with its pages and modules called what their schemas call them.
 *
 * A second step, because a preview is read from a store and the panes have to
 * exist before anything knows which previews to ask for. `titleOf` answers
 * null where there is no preview, which leaves the route or the module's
 * name.
 *
 * A named page keeps its route under the name: there, a name and an address
 * are two answers. An unnamed one is called its route and says it once.
 */
export function nameReviewPanes(
  model: ReviewPageModel,
  titleOf: (sourcePath: string) => string | null,
): ReviewPageModel {
  const panes: Record<string, ReviewPane> = {};
  for (const [id, pane] of Object.entries(model.panes)) {
    const title =
      pane.sourcePath === undefined ? null : titleOf(pane.sourcePath);
    panes[id] =
      title === null || title === pane.title
        ? pane
        : {
            ...pane,
            title,
            ...(pane.pageUrl !== undefined ? { location: pane.pageUrl } : {}),
          };
  }
  return { ...model, panes };
}

/**
 * The pane, and the row in it, that a source path names: where a link from
 * elsewhere in the Studio ("show me the change to this") lands.
 *
 * The row AT the path, else the first row inside it or around it, else the
 * pane the path is in with no row. Null when nothing here changed it.
 */
export function locateInReview(
  model: ReviewPageModel,
  sourcePath: string,
): { paneId: string; rowId: string | null } | null {
  let near: { paneId: string; rowId: string } | null = null;
  let within: { paneId: string; rowId: null } | null = null;
  for (const [paneId, pane] of Object.entries(model.panes)) {
    for (const row of pane.rows) {
      if (row.id === sourcePath) return { paneId, rowId: row.id };
      if (
        near === null &&
        (isPathWithin(row.id, sourcePath) || isPathWithin(sourcePath, row.id))
      ) {
        near = { paneId, rowId: row.id };
      }
    }
    if (
      within === null &&
      pane.sourcePath !== undefined &&
      isPathWithin(sourcePath, pane.sourcePath)
    ) {
      within = { paneId, rowId: null };
    }
  }
  return near ?? within;
}
