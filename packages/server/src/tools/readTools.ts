import {
  getSourcePathFromRoute,
  type ModuleFilePath,
  type Source,
  type SourcePath,
  type ValidationError,
} from "@valbuild/core";
import {
  describeContainerAtPath,
  filterBlockingValidationErrors,
  type ContainerKind,
} from "@valbuild/shared/internal";
import { z } from "zod";
import {
  defineTool,
  err,
  ok,
  type ValToolImpl,
  type ValToolState,
} from "./defineTool";
import type { ValToolResult } from "./types";

/**
 * The tools that only read.
 *
 * Names match the Studio's chat tools exactly. MCP clients namespace by server,
 * so there is no `val_` prefix to add, and keeping the names identical means
 * converging the two definitions later is a move rather than a rename.
 *
 * All of these read from `deps.state`, which already has pending patches
 * applied — an agent should see the content as the Studio would show it, not the
 * last published version.
 */

const ModuleFilePathSchema = z
  .string()
  .describe(
    'Path of the Val module, e.g. "/content/pages.val.ts". Use get_all_schema to discover these.',
  );

export function readTools(): ValToolImpl[] {
  return [
    defineTool(
      {
        name: "get_all_schema",
        title: "Get all schemas",
        description:
          "List every Val module in the project and its schema. Start here: the module paths this returns are what every other tool takes.",
        inputSchema: z.object({}),
        annotations: { readOnlyHint: true, idempotentHint: true },
      },
      async (_args, { state }) => ok(state.serializedSchemas),
    ),

    defineTool(
      {
        name: "get_source",
        title: "Get source",
        description:
          "Read the content of one Val module, with any unpublished changes already applied.",
        inputSchema: z.object({ moduleFilePath: ModuleFilePathSchema }),
        annotations: { readOnlyHint: true, idempotentHint: true },
      },
      async ({ moduleFilePath }, { state }) => {
        const path = moduleFilePath as ModuleFilePath;
        if (!(path in state.serializedSchemas)) {
          return err("not-found", unknownModuleMessage(path, state));
        }
        const source = state.sources[path];
        return ok(source === undefined ? null : source);
      },
    ),

    defineTool(
      {
        name: "get_record_keys",
        title: "Get record keys",
        description:
          "List the keys of the record or object at a path inside a module, a page at a time. Use this to enumerate entries without reading their contents — and before adding one, so you do not collide with an existing key. Fails on arrays, galleries, richtext and primitives: use count_entries for an array or richtext length, and get_source to read a gallery.",
        inputSchema: z.object({
          moduleFilePath: ModuleFilePathSchema,
          path: z
            .array(z.string())
            .default([])
            .describe(
              "Path within the module to the record or object. Empty means the module root.",
            ),
          // Clamped by the schema rather than in the handler: a negative offset
          // makes `slice` read from the END and a negative limit makes it drop
          // the last N, so either would return a window that is not the page
          // asked for while `total` alongside implied it was.
          limit: z
            .number()
            .int()
            .min(1)
            .default(100)
            .describe("Maximum number of keys to return."),
          offset: z
            .number()
            .int()
            .min(0)
            .default(0)
            .describe("Number of keys to skip, for paging."),
        }),
        annotations: { readOnlyHint: true, idempotentHint: true },
      },
      async ({ moduleFilePath, path, limit, offset }, { state }) => {
        const described = describeContainer(state, moduleFilePath, path);
        if (described.kind !== "ok") {
          return described.result;
        }
        const { container, value } = described;
        // Records and objects only, matching the Studio's tool of the same name.
        // A gallery's keys are file paths whose bytes live elsewhere, and
        // richtext blocks are positional — neither is a key set to hand back.
        if (
          (container !== "record" && container !== "object") ||
          !isPlainObject(value)
        ) {
          return err(
            "invalid-args",
            `The value at that path is ${article(container)} ${container}. get_record_keys only works on a record or an object — ${
              container === "array"
                ? "use count_entries for the array length"
                : container === "richtext"
                  ? "use count_entries for the number of blocks"
                  : "use get_source to read the gallery's entries"
            }.`,
          );
        }
        const keys = Object.keys(value);
        return ok({
          kind: container,
          keys: keys.slice(offset, offset + limit),
          // The unpaged size, so a caller can tell a short page from the end of
          // the record without asking for another one.
          total: keys.length,
        });
      },
    ),

    defineTool(
      {
        name: "count_entries",
        title: "Count entries",
        description:
          "Count the entries at a path inside a module — record or gallery keys, object fields, array indices, or top-level richtext blocks — without reading them. Use this to answer 'how many?' or to size a record before paging through it.",
        inputSchema: z.object({
          moduleFilePath: ModuleFilePathSchema,
          path: z
            .array(z.string())
            .default([])
            .describe(
              "Path within the module to count at. Empty means the module root.",
            ),
        }),
        annotations: { readOnlyHint: true, idempotentHint: true },
      },
      async ({ moduleFilePath, path }, { state }) => {
        const described = describeContainer(state, moduleFilePath, path);
        if (described.kind !== "ok") {
          return described.result;
        }
        const { container, value } = described;
        // Every container `describeContainerAtPath` admits can be counted, so
        // unlike get_record_keys this does not narrow further. Non-containers
        // never get this far.
        if (Array.isArray(value)) {
          return ok({ kind: container, count: value.length });
        }
        if (isPlainObject(value)) {
          return ok({ kind: container, count: Object.keys(value).length });
        }
        return err(
          "invalid-args",
          `The value at that path is ${article(container)} ${container}, which has nothing to count.`,
        );
      },
    ),

    defineTool(
      {
        name: "validate_content",
        title: "Validate content",
        description:
          "Check the project's content against its schemas, including unpublished changes. Returns only errors that would block publishing.",
        inputSchema: z.object({
          moduleFilePath: ModuleFilePathSchema.optional().describe(
            "Limit the check to one module. Omit to validate everything.",
          ),
        }),
        annotations: { readOnlyHint: true },
      },
      async ({ moduleFilePath }, { ops, state }) => {
        const validation = await ops.validateSources(
          state.schemas,
          state.sources,
          // Every module. The third argument filters which modules are
          // validated at all, so passing the pending-patch analysis would make
          // a project with no pending changes report `valid: true` without
          // having checked anything. Scoping to one module, when asked, is done
          // on the results below.
          undefined,
        );
        // `validateSources` hands back the files it could not check on its own;
        // running them is what turns "this path holds a file" into "that file is
        // actually there and matches its recorded metadata".
        const fileErrors = await ops.validateFiles(
          state.schemas,
          state.sources,
          validation.files,
          state.analysis.fileLastUpdatedByPatchId,
        );

        // Per-module results, flattened to the by-source-path shape the filter
        // takes. Merged rather than overwritten: a path can pick up an error
        // from validation and another from its file.
        const bySourcePath: Record<SourcePath, ValidationError[]> = {};
        const add = (path: SourcePath, errors: ValidationError[]) => {
          bySourcePath[path] = (bySourcePath[path] ?? []).concat(errors);
        };
        for (const moduleErrors of Object.values(validation.errors)) {
          for (const [path, errors] of Object.entries(
            moduleErrors.validations ?? {},
          )) {
            add(path as SourcePath, errors);
          }
        }
        for (const [path, errors] of Object.entries(fileErrors)) {
          add(path as SourcePath, errors);
        }

        // Drops the errors the Studio would not show either: ones whose only
        // effect is an offered fix. Left in, an agent would loop trying to
        // "repair" content that is already publishable.
        const blocking = filterBlockingValidationErrors(
          bySourcePath,
          state.serializedSchemas,
          state.sources,
        );

        // A module whose source could not be read at all has no source path to
        // hang an error on, so it is reported separately rather than lost.
        const unreadable = Object.entries(validation.errors)
          .filter(([, moduleErrors]) => moduleErrors.invalidSource)
          .map(([path, moduleErrors]) => ({
            moduleFilePath: path,
            message: moduleErrors.invalidSource?.message ?? "Invalid source",
          }));

        const scope = moduleFilePath as ModuleFilePath | undefined;
        const errors =
          scope === undefined ? blocking : filterKeysByModule(blocking, scope);
        const unreadableInScope =
          scope === undefined
            ? unreadable
            : unreadable.filter((u) => u.moduleFilePath === scope);

        return ok({
          valid:
            Object.keys(errors).length === 0 && unreadableInScope.length === 0,
          errors: Object.fromEntries(
            Object.entries(errors).map(([path, errs]) => [
              path,
              errs.map(toJsonValidationError),
            ]),
          ),
          // Always present, empty when there are none: a caller should not have
          // to tell "absent" from "empty" to decide whether content is publishable.
          unreadableModules: unreadableInScope,
        });
      },
    ),

    defineTool(
      {
        name: "get_patches",
        title: "Get patches",
        description:
          "List the unpublished changes in the project, oldest first, with who made each one.",
        inputSchema: z.object({
          moduleFilePath: ModuleFilePathSchema.optional().describe(
            "Limit to changes touching one module.",
          ),
        }),
        annotations: { readOnlyHint: true },
      },
      async ({ moduleFilePath }, { state }) => {
        const wanted =
          moduleFilePath === undefined
            ? state.patches.patches
            : state.patches.patches.filter((p) => p.path === moduleFilePath);
        return ok(
          wanted.map((patch) => ({
            patchId: patch.patchId,
            moduleFilePath: patch.path,
            createdAt: patch.createdAt,
            authorId: patch.authorId,
            // `appliedAt` non-null means this change is already committed, so it
            // is history rather than something still pending.
            published: patch.appliedAt !== null,
          })),
        );
      },
    ),

    defineTool(
      {
        name: "get_source_path_from_route",
        title: "Get source path from route",
        description:
          "Given a URL path on the site, find the Val module and source path that renders it. Use this when the user names a page rather than a module.",
        inputSchema: z.object({
          route: z
            .string()
            .describe('A route on the site, e.g. "/blog/my-post".'),
        }),
        annotations: { readOnlyHint: true, idempotentHint: true },
      },
      async ({ route }, { state }) => {
        const found = getSourcePathFromRoute(route, state.serializedSchemas);
        if (!found) {
          return err(
            "not-found",
            `No Val module renders the route ${JSON.stringify(route)}. Routes come from modules with a router configured; get_all_schema shows which have one.`,
          );
        }
        return ok(found);
      },
    ),
  ];
}

/**
 * Resolve a module and classify the value at a path inside it.
 *
 * Shared by `get_record_keys` and `count_entries` so the two cannot drift on
 * what counts as a missing module, and so both map the same failure to the same
 * error code: a path that is not there is `not-found`, while a path that is
 * there but holds a string or an image is `invalid-args` — the caller should
 * reach for a different tool, not go looking for the path again.
 */
function describeContainer(
  state: ValToolState,
  moduleFilePath: string,
  path: string[],
):
  | { kind: "ok"; container: ContainerKind; value: Source }
  | { kind: "error"; result: ValToolResult } {
  const modulePath = moduleFilePath as ModuleFilePath;
  const schema = state.serializedSchemas[modulePath];
  if (!schema) {
    return {
      kind: "error",
      result: err("not-found", unknownModuleMessage(modulePath, state)),
    };
  }
  const described = describeContainerAtPath(
    schema,
    state.sources[modulePath],
    path,
  );
  if (described.kind === "error") {
    return {
      kind: "error",
      result: err(
        described.reason === "missing" ? "not-found" : "invalid-args",
        described.message,
      ),
    };
  }
  return described;
}

/** "a record", but "an object" and "an array". */
function article(container: ContainerKind): string {
  return container === "object" || container === "array" ? "an" : "a";
}

function unknownModuleMessage(
  path: ModuleFilePath,
  state: { serializedSchemas: Record<ModuleFilePath, unknown> },
): string {
  const known = Object.keys(state.serializedSchemas);
  return `No Val module at ${JSON.stringify(path)}. Known modules: ${
    known.length === 0 ? "(none)" : known.join(", ")
  }`;
}

/**
 * Project a validation error into something JSON-safe and worth reading.
 *
 * `ValidationError.value` is dropped rather than serialized: it is `unknown` (so
 * not `Json` to begin with) and it holds the offending source value, which can
 * be arbitrarily large. A caller already has the source path and can read the
 * value with `get_source` if it needs to — putting it here would bloat every
 * result for the rare case that wants it.
 *
 * `fixes` is kept, because it names what Val already knows how to repair, which
 * is directly actionable.
 */
function toJsonValidationError(error: ValidationError): {
  message: string;
  fixes: string[];
  typeError: boolean;
  schemaError: boolean;
  keyError: boolean;
} {
  return {
    message: error.message,
    fixes: error.fixes ? [...error.fixes] : [],
    typeError: error.typeError === true,
    schemaError: error.schemaError === true,
    keyError: error.keyError === true,
  };
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Keep only the entries belonging to one module.
 *
 * Keyed by SourcePath, which begins with the module file path, so a prefix match
 * is the right test — there is no per-module grouping left to index by.
 */
function filterKeysByModule<T>(
  record: Record<SourcePath, T>,
  moduleFilePath: ModuleFilePath,
): Record<SourcePath, T> {
  const out: Record<SourcePath, T> = {};
  for (const [path, value] of Object.entries(record)) {
    if (path.startsWith(moduleFilePath)) {
      out[path as SourcePath] = value;
    }
  }
  return out;
}
