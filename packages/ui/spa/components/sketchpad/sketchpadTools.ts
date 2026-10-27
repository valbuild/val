import type { SketchpadT } from "@valbuild/shared/internal";
import { z } from "zod";
import type { AITool } from "../../hooks/useAIWebSocket";
import type { SketchpadClient, SketchpadResult } from "./sketchpadClient";
import type { SketchpadsState } from "./SketchpadsState";

/**
 * The format, as the assistant is told it: short, because it is in every
 * tool description that takes a text, and complete, because a write in any
 * other spelling is refused.
 */
export const SKETCH_FORMAT_HELP = [
  "A sketch is plain text, one block per line, two spaces of indent per level:",
  "`# Heading`, `## Sub`, `### Small`; any other line is a paragraph;",
  "`[kind: label]` is a box (kind is one word you choose, e.g. hero, quote, pricing);",
  "`[kind: label](image: url)` or `(video: url)` puts media in a box;",
  "`row` puts what is indented under it side by side, and is followed by `col` or `col 2` (2 shares of the row) lines, each holding blocks;",
  "after the page, ONE blank line, then `icon <kind> <svg path data>` lines: a 24x24 stroked line icon you draw for each kind you used.",
  "No other blank lines, no tabs, a final newline. Start a paragraph that would read as something else with `\\`.",
].join(" ");

const LIST_SKETCHPADS_TOOL: AITool = {
  name: "list_sketchpads",
  description:
    "List the project's sketchpads: rough pages people and you work out before anything is built. " +
    "Each has an id, the page it is about (a route, or null), a title (its first heading), a version and when it changed. " +
    "Archived ones are left out unless asked for. Use it to find one again when you do not have its id.",
  parameters: {
    type: "object",
    properties: {
      page: {
        type: "string",
        description: "Only sketchpads about this route, e.g. /about.",
      },
      archived: {
        type: "string",
        enum: ["exclude", "include", "only"],
        description: "Archived ones: exclude (default), include or only.",
      },
    },
    required: [],
  },
};

const CREATE_SKETCHPAD_TOOL: AITool = {
  name: "create_sketchpad",
  description:
    "Make a new sketchpad and show it to the person. Use it to sketch a page or a change to one before building it, " +
    "when the person wants to see or change the layout first. " +
    "Returns its id: KEEP IT, and use it with read_sketchpad and write_sketchpad for the rest of the conversation. " +
    SKETCH_FORMAT_HELP,
  parameters: {
    type: "object",
    properties: {
      text: { type: "string", description: "The sketch, in the format." },
      page: {
        type: "string",
        description:
          "The route of the page it is about (e.g. / or /blog/my-post). Leave it out for a page that does not exist yet.",
      },
    },
    required: ["text"],
  },
};

const READ_SKETCHPAD_TOOL: AITool = {
  name: "read_sketchpad",
  description:
    "Read a sketchpad as it is now: its text, page, version and whether it is archived. " +
    "People change sketchpads while you are not looking, so read one again before you change it or build from it.",
  parameters: {
    type: "object",
    properties: { id: { type: "string" } },
    required: ["id"],
  },
};

const WRITE_SKETCHPAD_TOOL: AITool = {
  name: "write_sketchpad",
  description:
    "Change a sketchpad: its whole text, the page it is about, or whether it is archived. " +
    "baseVersion is the version you read; if it changed since, the result is the sketchpad as it is now, and you make your change again on top of it. " +
    "An archived sketchpad is not changed unless you also set archived: false -- and reopen one only when the person asks. " +
    SKETCH_FORMAT_HELP,
  parameters: {
    type: "object",
    properties: {
      id: { type: "string" },
      baseVersion: { type: "number" },
      text: { type: "string", description: "The whole new text." },
      page: {
        type: "string",
        description:
          'The route it is about now, or "" for no page. Leave it out to keep it as it is.',
      },
      archived: { type: "boolean" },
    },
    required: ["id", "baseVersion"],
  },
};

export const SKETCHPAD_TOOLS: AITool[] = [
  LIST_SKETCHPADS_TOOL,
  CREATE_SKETCHPAD_TOOL,
  READ_SKETCHPAD_TOOL,
  WRITE_SKETCHPAD_TOOL,
];

export type SketchpadToolName =
  | "list_sketchpads"
  | "create_sketchpad"
  | "read_sketchpad"
  | "write_sketchpad";

export function isSketchpadToolName(name: string): name is SketchpadToolName {
  return SKETCHPAD_TOOLS.some((tool) => tool.name === name);
}

const ListArgs = z.object({
  page: z.string().optional(),
  archived: z.enum(["exclude", "include", "only"]).optional(),
});
/** A route, or "" (or null) for none. */
const PageArg = z
  .string()
  .nullable()
  .transform((page) => (page === "" ? null : page));
const CreateArgs = z.object({
  text: z.string(),
  page: PageArg.optional(),
});
const ReadArgs = z.object({ id: z.string() });
const WriteArgs = z.object({
  id: z.string(),
  baseVersion: z.number().int(),
  text: z.string().optional(),
  page: PageArg.optional(),
  archived: z.boolean().optional(),
});

export type SketchpadToolOutcome = { result: unknown; isError: boolean };

/** What the assistant is told about a sketchpad: all of it but who. */
function forModel(sketchpad: SketchpadT) {
  return {
    id: sketchpad.id,
    page: sketchpad.page,
    title: sketchpad.title,
    version: sketchpad.version,
    archived: sketchpad.archived,
    updatedAt: sketchpad.updatedAt,
    text: sketchpad.text,
  };
}

function failed(
  result: Exclude<SketchpadResult, { status: "ok" }>,
): SketchpadToolOutcome {
  switch (result.status) {
    case "refused":
      return {
        isError: true,
        result: {
          error: result.message,
          errors: result.errors,
        },
      };
    case "conflict":
      return {
        isError: true,
        result: {
          error: result.message,
          current: forModel(result.sketchpad),
        },
      };
    case "not-found":
    case "failed":
      return { isError: true, result: { error: result.message } };
  }
}

/**
 * Runs one of the sketchpad tools against the server. `state` is the Studio
 * shell's, when there is one: what the tools read and write is put there, so
 * the Sketchpad on screen shows it, and a new one is opened, so the person
 * sees what was made for them.
 */
export async function runSketchpadTool(
  name: SketchpadToolName,
  args: unknown,
  deps: { client: SketchpadClient; state: SketchpadsState | null },
): Promise<SketchpadToolOutcome> {
  const { client, state } = deps;
  const invalid = (error: z.ZodError): SketchpadToolOutcome => ({
    isError: true,
    result: {
      error: `${name}: ${error.issues.map((i) => `${i.path.join(".")} ${i.message}`).join("; ")}`,
    },
  });

  switch (name) {
    case "list_sketchpads": {
      const parsed = ListArgs.safeParse(args ?? {});
      if (!parsed.success) {
        return invalid(parsed.error);
      }
      const res = await client.list(parsed.data);
      if (res.status !== "ok") {
        return { isError: true, result: { error: res.message } };
      }
      return { isError: false, result: { sketchpads: res.sketchpads } };
    }
    case "create_sketchpad": {
      const parsed = CreateArgs.safeParse(args);
      if (!parsed.success) {
        return invalid(parsed.error);
      }
      const res = await client.create({
        text: parsed.data.text,
        page: parsed.data.page ?? null,
      });
      if (res.status !== "ok") {
        return failed(res);
      }
      state?.put(res.sketchpad);
      state?.open(res.sketchpad.id);
      return {
        isError: false,
        result: {
          id: res.sketchpad.id,
          version: res.sketchpad.version,
          page: res.sketchpad.page,
          title: res.sketchpad.title,
          note: `Keep this id (${res.sketchpad.id}): read_sketchpad and write_sketchpad take it. ${
            state ? "The person has it on screen now." : ""
          }`,
        },
      };
    }
    case "read_sketchpad": {
      const parsed = ReadArgs.safeParse(args);
      if (!parsed.success) {
        return invalid(parsed.error);
      }
      const res = await client.get(parsed.data.id);
      if (res.status !== "ok") {
        return failed(res);
      }
      state?.put(res.sketchpad);
      return { isError: false, result: forModel(res.sketchpad) };
    }
    case "write_sketchpad": {
      const parsed = WriteArgs.safeParse(args);
      if (!parsed.success) {
        return invalid(parsed.error);
      }
      const res = await client.update(parsed.data);
      if (res.status !== "ok") {
        if (res.status === "conflict") {
          state?.put(res.sketchpad);
        }
        return failed(res);
      }
      state?.put(res.sketchpad);
      // Shown, unless the person has another one open: switching that away
      // under them would be worse than a dot on the top bar.
      if (
        state &&
        state.getSnapshot().openId === null &&
        !res.sketchpad.archived
      ) {
        state.open(res.sketchpad.id);
      }
      return {
        isError: false,
        result: {
          id: res.sketchpad.id,
          version: res.sketchpad.version,
          page: res.sketchpad.page,
          archived: res.sketchpad.archived,
        },
      };
    }
  }
}
