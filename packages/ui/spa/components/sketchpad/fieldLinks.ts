import {
  Internal,
  type Json,
  type ModuleFilePath,
  type SerializedSchema,
  type SourcePath,
} from "@valbuild/core";
import {
  parseSketch,
  resolveSerializedSchemaAtPath,
  sketchFieldTexts,
} from "@valbuild/shared/internal";
import type { Node as PMNode } from "prosemirror-model";
import {
  Plugin,
  PluginKey,
  type EditorState,
  type Transaction,
} from "prosemirror-state";
import { Decoration, DecorationSet, type EditorView } from "prosemirror-view";

/**
 * A heading or paragraph of a sketch can be LINKED to a text field of the
 * site (`{field: <source path>}` in the sketch text): typing in the block
 * writes the field, as typing in the field would. A try-out: the sketch is
 * a plan everywhere else, and this is the one place it is content.
 *
 * - Only a plain text field (`s.string()`) is linked. Rich text, numbers
 *   and the rest would need the sketch to speak their language.
 * - Only CHANGES are written. A link the assistant just wrote, or a sketch
 *   opened on content that moved on, writes nothing: the block says the two
 *   differ, and offers the content's text.
 * - The link can be broken, from the block, at any time.
 */

/** What a link points at, as the block shows it. */
export type FieldLinkInfo =
  | { status: "ok"; label: string; value: string }
  /** The path is there, and is not a text field: nothing is written. */
  | { status: "not-text"; label: string }
  /** A text field of several lines, which one block cannot hold. */
  | { status: "multiline"; label: string }
  /** No such field (any more): nothing is written. */
  | { status: "missing"; label: string };

/** "hero › title": the field's own name, and the one above it. */
export function fieldLabel(field: string): string {
  try {
    const [moduleFilePath, modulePath] =
      Internal.splitModuleFilePathAndModulePath(asSourcePath(field));
    const names = (modulePath ? Internal.splitModulePath(modulePath) : [])
      .filter((segment) => !/^\d+$/.test(segment))
      .slice(-2);
    return names.length > 0
      ? names.join(" › ")
      : (moduleFilePath.split("/").pop() ?? field);
  } catch {
    return field;
  }
}

/** The link as the Studio sees the content now. */
export function fieldLinkInfo(
  field: string,
  schemas: Readonly<Record<ModuleFilePath, SerializedSchema>>,
  sources: Readonly<Record<ModuleFilePath, Json>>,
): FieldLinkInfo {
  const label = fieldLabel(field);
  const at = splitField(field);
  if (!at) {
    return { status: "missing", label };
  }
  const schema = schemas[at.moduleFilePath];
  if (!schema) {
    return { status: "missing", label };
  }
  const resolved = resolveSerializedSchemaAtPath(schema, at.path);
  const value = valueAt(sources[at.moduleFilePath], at.path);
  if (resolved.kind === "unresolved" || value === undefined) {
    return { status: "missing", label };
  }
  if (
    resolved.kind !== "leaf" ||
    resolved.schema.type !== "string" ||
    typeof value !== "string"
  ) {
    return { status: "not-text", label };
  }
  // A block is one line: written back, the field's line breaks would go.
  if (resolved.schema.multiline) {
    return { status: "multiline", label };
  }
  return { status: "ok", label, value };
}

/**
 * What typing in the sketch changed in linked fields: every field linked
 * both before and after whose text is not the same. A link that is new, or
 * gone, is not a change to the content.
 */
export function linkedFieldChanges(
  before: string,
  after: string,
): { field: string; text: string }[] {
  const was = sketchFieldTexts(parseSketch(before).blocks);
  const now = sketchFieldTexts(parseSketch(after).blocks);
  const changes: { field: string; text: string }[] = [];
  now.forEach((text, field) => {
    const previous = was.get(field);
    if (previous !== undefined && previous !== text) {
      changes.push({ field, text });
    }
  });
  return changes;
}

/** Where a link writes: the module, and the patch path inside it. */
export function splitField(
  field: string,
): { moduleFilePath: ModuleFilePath; path: string[] } | null {
  try {
    const [moduleFilePath, modulePath] =
      Internal.splitModuleFilePathAndModulePath(asSourcePath(field));
    if (!modulePath) {
      return null;
    }
    return {
      moduleFilePath,
      path: Internal.createPatchPath(modulePath),
    };
  } catch {
    return null;
  }
}

function asSourcePath(field: string): SourcePath {
  // A source path is a string with a brand; the sketch holds it as text.
  return field as SourcePath;
}

function valueAt(source: Json | undefined, path: string[]): unknown {
  let current: unknown = source;
  for (const segment of path) {
    if (Array.isArray(current)) {
      current = current[Number(segment)];
    } else if (isRecord(current)) {
      current = current[segment];
    } else {
      return undefined;
    }
  }
  return current;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export const fieldLinksKey = new PluginKey<number>("fieldLinks");

/**
 * The link on each linked block: a chip at its end with the field's name,
 * and a way to break the link; a warning when the field's text is not the
 * block's, with a way to take the field's. One block per field: a block
 * split in two keeps the link on the first half only.
 */
export function fieldLinks(
  getInfo: () => ((field: string) => FieldLinkInfo) | undefined,
): Plugin<number> {
  return new Plugin<number>({
    key: fieldLinksKey,
    state: {
      init: () => 0,
      // Bumped when the content changes, so the chips say how it is now.
      apply: (tr, value) => tr.getMeta(fieldLinksKey) ?? value,
    },
    appendTransaction(transactions, _old, state) {
      if (!transactions.some((tr) => tr.docChanged)) {
        return null;
      }
      // Every block linked to each field, in order.
      const byField = new Map<string, { pos: number; node: PMNode }[]>();
      state.doc.descendants((node, pos) => {
        const field = linkOf(node);
        if (field !== null) {
          byField.set(field, [...(byField.get(field) ?? []), { pos, node }]);
        }
      });
      // The link stays with the text: Enter at the START of a linked
      // paragraph gives the empty line above it the same attributes, and
      // that line must not take the link -- typing there would write it.
      let tr: Transaction | null = null;
      byField.forEach((blocks) => {
        if (blocks.length < 2) {
          return;
        }
        const keep =
          blocks.find((block) => block.node.textContent.trim() !== "") ??
          blocks[0];
        for (const block of blocks) {
          if (block !== keep) {
            tr = (tr ?? state.tr).setNodeMarkup(block.pos, undefined, {
              ...block.node.attrs,
              field: null,
            });
          }
        }
      });
      return tr;
    },
    props: {
      decorations(state) {
        const info = getInfo();
        if (!info) {
          return DecorationSet.empty;
        }
        const decorations: Decoration[] = [];
        state.doc.descendants((node, pos) => {
          const field = linkOf(node);
          if (field === null) {
            return;
          }
          const link = info(field);
          const text = node.textContent.replace(/\s+/g, " ").trim();
          const differs =
            link.status === "ok" &&
            link.value.replace(/\s+/g, " ").trim() !== text;
          decorations.push(
            Decoration.node(pos, pos + node.nodeSize, {
              "data-field-link": differs ? "differs" : link.status,
            }),
            Decoration.widget(
              // At the START, and out of the flow: a widget at the end of a
              // textblock makes ProseMirror add a line break after it, and
              // a click on that empty line put the caret at the end.
              pos + 1,
              (view, getPos) => chipElement(view, getPos, field, link, differs),
              {
                side: -1,
                ignoreSelection: true,
                key: `field-${field}-${link.status}-${differs ? `differs:${link.status === "ok" ? link.value : ""}` : "same"}`,
              },
            ),
          );
        });
        return DecorationSet.create(state.doc, decorations);
      },
    },
  });
}

function linkOf(node: PMNode): string | null {
  const field: unknown = node.attrs.field;
  return node.isTextblock && typeof field === "string" && field !== ""
    ? field
    : null;
}

/** The block the widget at `pos` sits in. */
function blockAt(
  state: EditorState,
  pos: number,
): { node: PMNode; pos: number } | null {
  const $pos = state.doc.resolve(pos);
  if ($pos.depth === 0) {
    return null;
  }
  return { node: $pos.parent, pos: $pos.before() };
}

function chipElement(
  view: EditorView,
  getPos: () => number | undefined,
  field: string,
  link: FieldLinkInfo,
  differs: boolean,
): HTMLElement {
  const el = document.createElement("span");
  el.contentEditable = "false";
  el.dataset.fieldChip = field;
  el.className =
    "absolute -top-4 right-0 z-10 inline-flex select-none items-center gap-1 whitespace-nowrap rounded-full border px-1.5 text-[10px] font-normal leading-4 " +
    (link.status === "ok" && !differs
      ? "border-border-primary bg-bg-secondary text-fg-secondary"
      : "border-border-warning-secondary bg-bg-warning-secondary text-fg-warning-secondary");
  el.title =
    link.status === "ok"
      ? `Linked to ${field}: typing here changes it.`
      : link.status === "not-text"
        ? `${field} is not a text field, so typing here does not change it.`
        : link.status === "multiline"
          ? `${field} holds several lines, and a block one, so typing here does not change it.`
          : `${field} is not in the content, so typing here changes nothing.`;
  const label = document.createElement("span");
  label.textContent =
    link.status === "ok"
      ? differs
        ? `${link.label}: changed elsewhere`
        : link.label
      : link.status === "not-text"
        ? `${link.label}: not a text field`
        : link.status === "multiline"
          ? `${link.label}: several lines, not linked`
          : `${link.label}: not found`;
  el.append(label);

  const button = (text: string, onPress: () => void) => {
    const b = document.createElement("button");
    b.type = "button";
    b.textContent = text;
    b.className = "cursor-pointer underline";
    b.addEventListener("mousedown", (event) => event.preventDefault());
    b.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      onPress();
    });
    return b;
  };
  if (link.status === "ok" && differs) {
    el.append(
      button("Use the content's", () => {
        const pos = getPos();
        const block = pos === undefined ? null : blockAt(view.state, pos);
        if (!block) return;
        const from = block.pos + 1;
        const to = block.pos + block.node.nodeSize - 1;
        view.dispatch(
          link.value === ""
            ? view.state.tr.delete(from, to)
            : view.state.tr.replaceWith(
                from,
                to,
                view.state.schema.text(link.value),
              ),
        );
      }),
    );
  }
  el.append(
    button("Unlink", () => {
      const pos = getPos();
      const block = pos === undefined ? null : blockAt(view.state, pos);
      if (!block) return;
      view.dispatch(
        view.state.tr.setNodeMarkup(block.pos, undefined, {
          ...block.node.attrs,
          field: null,
        }),
      );
    }),
  );
  return el;
}
