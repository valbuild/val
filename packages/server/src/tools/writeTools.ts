import type { ModuleFilePath } from "@valbuild/core";
import type { Patch } from "@valbuild/core/patch";
import {
  buildDuplicatePatch,
  buildEmptyAtPathPatch,
  buildRemoveImageGalleryEntryPatch,
  safeParsePatch,
  type BuildResult,
} from "@valbuild/shared/internal";
import { z } from "zod";
import { defineTool, err, type ValToolImpl } from "./defineTool";
import { savePatch } from "./writePath";
import type { ValToolResult } from "./types";

/**
 * The tools that change content.
 *
 * Every one of them goes through {@link savePatch}, so they all inherit the same
 * guarantees: the change is validated against the real schemas before anything
 * is stored, a rejected change stores nothing, and a lost race with another
 * writer is retried once and then reported rather than looped on.
 *
 * Images are not here. The Studio's image tools work from a handle into Val's
 * AI session store — bytes the browser got from the vision system — and MCP has
 * no equivalent, so they need a different affordance (a local file path, or
 * inline base64) rather than a port. `docs/plans/mcp.md` Part B has the reasoning.
 */

const ModuleFilePathSchema = z
  .string()
  .describe('Path of the Val module, e.g. "/content/pages.val.ts".');

export function writeTools(): ValToolImpl[] {
  return [
    defineTool(
      {
        name: "create_patch",
        title: "Create patch",
        description:
          "Change content in a Val module by applying JSON Patch operations. The change is validated first and is rejected outright if it would make the content invalid. Text and JSON values only — not files or images.",
        inputSchema: z.object({
          moduleFilePath: ModuleFilePathSchema,
          patch: z
            .array(z.unknown())
            .describe(
              'JSON Patch operations, e.g. [{"op":"replace","path":["title"],"value":"New title"}]. Paths are arrays of keys, not slash-separated strings.',
            ),
        }),
        annotations: { idempotentHint: false },
      },
      async ({ moduleFilePath, patch }, deps) => {
        const parsed = safeParsePatch(patch);
        if (parsed.kind !== "ok") {
          return fromBuildResult(parsed);
        }
        const rejected = rejectFileOps(parsed.patch);
        if (rejected) {
          return rejected;
        }
        return savePatch(deps, moduleFilePath as ModuleFilePath, parsed.patch);
      },
    ),

    defineTool(
      {
        name: "duplicate_source",
        title: "Duplicate source",
        description:
          "Copy the value at one path in a module to another path. Use this to add an entry modelled on an existing one, rather than composing it field by field.",
        inputSchema: z.object({
          moduleFilePath: ModuleFilePathSchema,
          sourcePath: z
            .array(z.string())
            .describe("Path of the value to copy."),
          destinationPath: z
            .array(z.string())
            .describe("Path to copy it to. Must not already exist."),
        }),
        annotations: { idempotentHint: false },
      },
      async ({ moduleFilePath, sourcePath, destinationPath }, deps) => {
        const modulePath = moduleFilePath as ModuleFilePath;
        const schema = deps.state.serializedSchemas[modulePath];
        if (!schema) {
          return err(
            "not-found",
            `No Val module at ${JSON.stringify(modulePath)}.`,
          );
        }
        const built = buildDuplicatePatch(
          { sourcePath, destinationPath },
          schema,
          deps.state.sources[modulePath],
        );
        if (built.kind !== "ok") {
          return fromBuildResult(built);
        }
        return savePatch(deps, modulePath, built.patch);
      },
    ),

    defineTool(
      {
        name: "empty_at_path",
        title: "Create an empty value at a path",
        description:
          "Create a new, schema-correct empty value at a path — an empty entry in a record or array, for instance. Prefer this over composing one by hand: it derives the shape from the schema, including required fields.",
        inputSchema: z.object({
          moduleFilePath: ModuleFilePathSchema,
          destinationPath: z
            .array(z.string())
            .describe("Path to create the empty value at."),
        }),
        annotations: { idempotentHint: false },
      },
      async ({ moduleFilePath, destinationPath }, deps) => {
        const modulePath = moduleFilePath as ModuleFilePath;
        const schema = deps.state.serializedSchemas[modulePath];
        if (!schema) {
          return err(
            "not-found",
            `No Val module at ${JSON.stringify(modulePath)}.`,
          );
        }
        const built = buildEmptyAtPathPatch({ destinationPath }, schema);
        if (built.kind !== "ok") {
          return fromBuildResult(built);
        }
        return savePatch(deps, modulePath, built.patch);
      },
    ),

    defineTool(
      {
        name: "remove_image_gallery_entry",
        title: "Remove an image gallery entry",
        description:
          "Remove one image from an image gallery module by its file path. This deletes the entry and the file it refers to.",
        inputSchema: z.object({
          moduleFilePath: ModuleFilePathSchema.describe(
            "The gallery module, i.e. one declared with s.images() or s.files().",
          ),
          filePath: z
            .string()
            .describe(
              'The gallery key to remove, e.g. "/public/val/photo_a1b2c.jpg".',
            ),
        }),
        // Destructive: it removes content and the underlying file, so a host
        // that asks for confirmation should ask here.
        annotations: { destructiveHint: true, idempotentHint: false },
      },
      async ({ moduleFilePath, filePath }, deps) => {
        const modulePath = moduleFilePath as ModuleFilePath;
        const schema = deps.state.serializedSchemas[modulePath];
        if (!schema) {
          return err(
            "not-found",
            `No Val module at ${JSON.stringify(modulePath)}.`,
          );
        }
        const built = buildRemoveImageGalleryEntryPatch(
          { filePath },
          schema,
          deps.state.sources[modulePath],
        );
        if (built.kind !== "ok") {
          return fromBuildResult(built);
        }
        return savePatch(deps, modulePath, built.patch);
      },
    ),
  ];
}

/**
 * Turn a helper's build failure into a tool error.
 *
 * `wrong-tool` is worth keeping distinct: the helpers can tell that the caller
 * reached for the wrong tool and which one it should have used, and passing that
 * through is what lets a model correct itself in one step instead of retrying
 * the same call.
 */
function fromBuildResult(
  built: Exclude<BuildResult, { kind: "ok" }>,
): ValToolResult {
  if (built.kind === "wrong-tool") {
    return {
      status: "error",
      code: "invalid-args",
      message: `${built.reason} Use the ${built.suggestedTool} tool instead.`,
    };
  }
  return { status: "error", code: "invalid-args", message: built.message };
}

/**
 * File operations are refused rather than half-supported.
 *
 * A `file` op carries binary content that has to be uploaded before the patch
 * is synced — a two-phase flow this pass does not implement. Letting one through
 * would store a patch referring to bytes that were never uploaded, which fails
 * later and a long way from the cause.
 */
function rejectFileOps(patch: Patch): ValToolResult | null {
  const hasFileOp = patch.some((op) => op.op === "file");
  if (!hasFileOp) {
    return null;
  }
  return {
    status: "error",
    code: "unsupported",
    message:
      "This patch contains a file operation. Uploading files is not supported over MCP yet — only text and JSON values can be changed.",
  };
}
