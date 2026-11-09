import {
  parseSketch,
  type SketchNode,
  type SketchpadT,
} from "@valbuild/shared/internal";
import { z } from "zod";
import type { AITool } from "../../hooks/useAIWebSocket";
import type { SketchpadClient, SketchpadResult } from "./sketchpadClient";
import type { SketchpadsState } from "./SketchpadsState";
import type { SketchHighlight, SketchHighlightColor } from "./highlights";

/**
 * The format, as the assistant is told it: short, because it is in every
 * tool description that takes a text, and complete, because a write in any
 * other spelling is refused.
 */
export const SKETCH_FORMAT_HELP = [
  "A sketch is plain text, one block per line, two spaces of indent per level:",
  "`# Heading`, `## Sub`, `### Small`; any other line is a paragraph;",
  "`[kind: label]` is a box (kind is one word you choose, e.g. hero, quote, pricing);",
  "`[kind: label](image: src)` or `(video: src)` puts media in a box; src is an image's `path` exactly as the content has it (e.g. /public/val/hero.webp, or its remote URL), or `session:<image_key>` for an image in this chat -- never make one up or use a web address: an image that is not in the project is refused;",
  "`row` puts what is indented under it side by side, and is followed by `col` lines, each holding blocks (columns share a row equally);",
  "a heading or paragraph may end with ` {field: <source path>}`: it is then linked to that plain text field (s.string()), and typing in it writes the field -- link only text that comes from that field, one block per field;",
  "`--- /route` on a line of its own, not indented, starts the part about the page at that route: one sketch can cover several pages;",
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

const HIGHLIGHT_COLOR_NAMES: SketchHighlightColor[] = [
  "red",
  "amber",
  "green",
  "blue",
  "purple",
];

const HIGHLIGHT_SKETCHPAD_BLOCKS_TOOL: AITool = {
  name: "highlight_sketchpad_blocks",
  description:
    "Point at blocks of a sketchpad on the person's screen: they are outlined in a color, with your note beside them, until you or the person clear them. " +
    "Use it to show WHICH blocks you mean, e.g. the ones that need a kind of section the site does not have yet (and so need code), before asking whether to go on. " +
    'Name the blocks by `lines` (1-based line numbers of the text as read_sketchpad returned it) or by `match` (a line\'s text, e.g. "[pricing: Plans]"; leading spaces do not matter). ' +
    "Returns the highlight's id, for clear_sketchpad_highlights.",
  parameters: {
    type: "object",
    properties: {
      id: { type: "string", description: "The sketchpad's id." },
      lines: { type: "array", items: { type: "number" } },
      match: { type: "array", items: { type: "string" } },
      color: { type: "string", enum: HIGHLIGHT_COLOR_NAMES },
      note: {
        type: "string",
        description: "Short: why these blocks. Shown beside them.",
      },
    },
    required: ["id", "color", "note"],
  },
};

const CLEAR_SKETCHPAD_HIGHLIGHTS_TOOL: AITool = {
  name: "clear_sketchpad_highlights",
  description:
    "Take highlights off a sketchpad: one, by the id highlight_sketchpad_blocks returned, or all of them. " +
    "Clear them once they have done their job, e.g. when the person has answered.",
  parameters: {
    type: "object",
    properties: {
      id: { type: "string", description: "The sketchpad's id." },
      highlightId: {
        type: "string",
        description: "Leave it out to clear all of them.",
      },
    },
    required: ["id"],
  },
};

export const SKETCHPAD_TOOLS: AITool[] = [
  LIST_SKETCHPADS_TOOL,
  CREATE_SKETCHPAD_TOOL,
  READ_SKETCHPAD_TOOL,
  WRITE_SKETCHPAD_TOOL,
  HIGHLIGHT_SKETCHPAD_BLOCKS_TOOL,
  CLEAR_SKETCHPAD_HIGHLIGHTS_TOOL,
];

export type SketchpadToolName =
  | "list_sketchpads"
  | "create_sketchpad"
  | "read_sketchpad"
  | "write_sketchpad"
  | "highlight_sketchpad_blocks"
  | "clear_sketchpad_highlights";

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

const HighlightArgs = z.object({
  id: z.string(),
  lines: z.array(z.number().int()).optional(),
  match: z.array(z.string()).optional(),
  color: z.enum(["red", "amber", "green", "blue", "purple"]),
  note: z.string(),
});
const ClearArgs = z.object({
  id: z.string(),
  highlightId: z.string().optional(),
});

/**
 * The 1-based lines `lines` and `match` name in `text`: a match is a line
 * whose text, without its indent, is the one given. What names nothing is
 * returned too, so the assistant is told rather than left to guess.
 */
export function resolveHighlightLines(
  text: string,
  named: { lines?: number[]; match?: string[] },
): { lines: number[]; unknown: string[] } {
  const textLines = text.split("\n");
  const lines = new Set<number>();
  const unknown: string[] = [];
  for (const line of named.lines ?? []) {
    if (line >= 1 && line <= textLines.length && textLines[line - 1] !== "") {
      lines.add(line);
    } else {
      unknown.push(`line ${line}`);
    }
  }
  for (const wanted of named.match ?? []) {
    const trimmed = wanted.trim();
    let found = false;
    textLines.forEach((line, i) => {
      if (trimmed !== "" && line.trim() === trimmed) {
        lines.add(i + 1);
        found = true;
      }
    });
    if (!found) {
      unknown.push(wanted);
    }
  }
  return { lines: [...lines].sort((a, b) => a - b), unknown };
}

/** Every image or video a sketch's boxes name. */
export function sketchMediaSrcs(text: string): string[] {
  const srcs = new Set<string>();
  const walk = (node: SketchNode) => {
    if (node.type === "placeholder" && node.media) {
      srcs.add(node.media.src);
    } else if (node.type === "row" || node.type === "col") {
      node.children.forEach(walk);
    }
  };
  parseSketch(text).blocks.forEach(walk);
  return Array.from(srcs);
}

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
  deps: {
    client: SketchpadClient;
    state: SketchpadsState | null;
    /** Makes a highlight's id: random in the Studio, fixed in a test. */
    newId?: () => string;
    /**
     * Whether a box may name this image: it is in a gallery, in the content,
     * or in the chat. Without it, any image is taken.
     */
    mediaKnown?: (src: string) => boolean;
  },
): Promise<SketchpadToolOutcome> {
  const { client, state } = deps;
  /**
   * The images `text` ADDS that the project does not have. One already in
   * the sketch is the person's, or was checked when it was written: an
   * image since replaced in the content must not block every later write.
   */
  const unknownMedia = (
    text: string,
    before = "",
  ): SketchpadToolOutcome | null => {
    if (!deps.mediaKnown) {
      return null;
    }
    const already = new Set(sketchMediaSrcs(before));
    const unknown = sketchMediaSrcs(text).filter(
      (src) => !already.has(src) && !deps.mediaKnown?.(src),
    );
    return unknown.length === 0
      ? null
      : {
          isError: true,
          result: {
            error: `Not written: these images are not in the project: ${unknown.join(", ")}. A box shows an image from a gallery or the content (its path exactly as get_source gives it), or session:<image_key> for one in this chat.`,
          },
        };
  };
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
      const refusedMedia = unknownMedia(parsed.data.text);
      if (refusedMedia) {
        return refusedMedia;
      }
      const res = await client.create({
        text: parsed.data.text,
        page: parsed.data.page ?? null,
      });
      if (res.status !== "ok") {
        return failed(res);
      }
      state?.markAssistantRead(res.sketchpad);
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
      state?.markAssistantRead(res.sketchpad);
      return { isError: false, result: forModel(res.sketchpad) };
    }
    case "write_sketchpad": {
      const parsed = WriteArgs.safeParse(args);
      if (!parsed.success) {
        return invalid(parsed.error);
      }
      let refusedMedia: SketchpadToolOutcome | null = null;
      if (parsed.data.text !== undefined && deps.mediaKnown) {
        const current =
          state?.getSnapshot().byId[parsed.data.id] ??
          (await client
            .get(parsed.data.id)
            .then((res) => (res.status === "ok" ? res.sketchpad : undefined)));
        refusedMedia = unknownMedia(parsed.data.text, current?.text);
      }
      if (refusedMedia) {
        return refusedMedia;
      }
      const res = await client.update(parsed.data);
      if (res.status !== "ok") {
        if (res.status === "conflict") {
          state?.put(res.sketchpad);
        }
        return failed(res);
      }
      state?.markAssistantRead(res.sketchpad);
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
    case "highlight_sketchpad_blocks": {
      const parsed = HighlightArgs.safeParse(args);
      if (!parsed.success) {
        return invalid(parsed.error);
      }
      if (!state) {
        return {
          isError: true,
          result: {
            error:
              "There is no Sketchpad on screen here to highlight in. Name the blocks in your answer instead.",
          },
        };
      }
      const { id, color, note } = parsed.data;
      if (!parsed.data.lines?.length && !parsed.data.match?.length) {
        return {
          isError: true,
          result: { error: "Name the blocks: give lines, match, or both." },
        };
      }
      // The text the person has on screen, which is what is highlighted.
      let sketchpad = state.getSnapshot().byId[id];
      if (!sketchpad) {
        const res = await client.get(id);
        if (res.status !== "ok") {
          return failed(res);
        }
        state.put(res.sketchpad);
        sketchpad = res.sketchpad;
      }
      const resolved = resolveHighlightLines(sketchpad.text, parsed.data);
      if (resolved.lines.length === 0) {
        return {
          isError: true,
          result: {
            error: `None of these name a block of the sketchpad as it is now (version ${sketchpad.version}): ${resolved.unknown.join(", ")}. Read it again.`,
          },
        };
      }
      const highlight: SketchHighlight = {
        id:
          deps.newId?.() ??
          crypto.getRandomValues(new Uint32Array(1))[0].toString(36),
        lines: resolved.lines,
        color,
        note,
      };
      state.addHighlights(id, [highlight]);
      if (state.getSnapshot().openId === null) {
        state.open(id);
      }
      return {
        isError: false,
        result: {
          highlightId: highlight.id,
          lines: highlight.lines,
          ...(resolved.unknown.length > 0
            ? { notFound: resolved.unknown }
            : {}),
        },
      };
    }
    case "clear_sketchpad_highlights": {
      const parsed = ClearArgs.safeParse(args);
      if (!parsed.success) {
        return invalid(parsed.error);
      }
      state?.clearHighlight(parsed.data.id, parsed.data.highlightId ?? null);
      return { isError: false, result: { cleared: true } };
    }
  }
}
