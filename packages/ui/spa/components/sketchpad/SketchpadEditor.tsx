import {
  BetweenVerticalEnd,
  Columns2,
  FileText,
  Heading1,
  Heading2,
  Heading3,
  Pilcrow,
  SquareDashed,
  Trash2,
  type LucideIcon,
} from "lucide-react";
import { Internal } from "@valbuild/core";
import { baseKeymap, setBlockType } from "prosemirror-commands";
import { dropCursor } from "prosemirror-dropcursor";
import { gapCursor } from "prosemirror-gapcursor";
import { history, redo, undo } from "prosemirror-history";
import {
  InputRule,
  inputRules,
  textblockTypeInputRule,
} from "prosemirror-inputrules";
import { keymap } from "prosemirror-keymap";
import type { Node as PMNode, NodeType } from "prosemirror-model";
import {
  EditorState,
  Plugin,
  TextSelection,
  type Command,
  type Transaction,
} from "prosemirror-state";
import { Decoration, DecorationSet, EditorView } from "prosemirror-view";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { cn } from "../designSystem/cn";
import { BoxView, type SketchBlockType } from "./boxNodeView";
import { dragHandles } from "./dragBlocks";
import { highlights, highlightsKey, type SketchHighlight } from "./highlights";
import { RouteView } from "./routeNodeView";
import type { SketchMedia } from "@valbuild/shared/internal";
import { docFromSketch, sketchFromDoc, sketchSchema } from "./sketchpadDoc";

const nodes = sketchSchema.nodes;
const NO_HIGHLIGHTS: SketchHighlight[] = [];

export type SketchpadEditorProps = {
  value: string;
  onChange?: (value: string) => void;
  readOnly?: boolean;
  /**
   * Stores a file put in a box; null when it could not (and said why). Null
   * where nothing can store one: a box then takes a link, and a file dropped
   * on it is `onFileRefused`.
   */
  attach: ((file: File) => Promise<SketchMedia | null>) | null;
  /** A file was dropped where there is nowhere to store it. */
  onFileRefused?: (file: File) => void;
  /**
   * Where the bytes a box's link names are served from. The link is a
   * content path as often as a URL -- `/public/val/hero.webp`, which the
   * assistant copies from the page -- and the browser cannot load that.
   * Defaults to `defaultMediaUrl`. A new function redraws the boxes.
   */
  mediaUrl?: (src: string) => string;
  /**
   * The image picker: the project's galleries, the images already on the
   * site, and this chat's uploads. Given, a box picks from it and nothing
   * else, so a sketch only ever names files the project has.
   */
  pickMedia?: (current: SketchMedia | null) => Promise<SketchMedia | null>;
  /** Whether the project has the file a box names; see `BoxViewOptions`. */
  mediaKnown?: (src: string) => boolean | null;
  /** The kinds of block the site's code renders; see `SketchBlockType`. */
  blockTypes?: SketchBlockType[];
  /** The site's routes, for a route divider to pick from. */
  routes?: string[];
  /** The route whose page is shown beside the sketch. */
  activeRoute?: string | null;
  /** A route divider was pressed: show that page beside the sketch. */
  onOpenRoute?: (route: string) => void;
  /** Blocks the assistant points at; see `SketchHighlight`. */
  highlights?: SketchHighlight[];
  /**
   * More ProseMirror plugins. This is where working together plugs in: a
   * proposal's Sketchpad is shared the way its chats are (Flow H), so the
   * relay's `prosemirror-collab` plugin and, later, presence decorations go
   * here, with the document -- not the text -- as what is synced.
   */
  plugins?: Plugin[];
  /**
   * Where the toolbar is: above the page, or under it -- on a phone, where
   * the thumb is and where the keyboard pushes it up to.
   */
  toolbar?: "top" | "bottom";
  /** Tap-sized controls, for a touch screen. */
  touch?: boolean;
};

/**
 * A box's link as the browser can load it: a content path on the site
 * (`/public/val/hero.webp`) where the site serves it (`/val/hero.webp`), and
 * anything else -- a web address, another path -- as it is. What the Studio
 * shows for every other image, `Internal.mediaUrl`, without the patch id an
 * unpublished file needs: the Studio passes its own `mediaUrl` for that.
 */
export function defaultMediaUrl(src: string): string {
  return Internal.mediaUrl({ path: src });
}

/**
 * The page as one editable document. The caret moves through it with the
 * arrow keys, columns included; `#` makes a heading and `[kind: label]` a box,
 * as they do in the text; the toolbar does the rest.
 */
export function SketchpadEditor({
  value,
  onChange,
  readOnly = false,
  attach,
  onFileRefused,
  mediaUrl = defaultMediaUrl,
  pickMedia,
  mediaKnown,
  blockTypes,
  routes,
  activeRoute = null,
  onOpenRoute,
  highlights: highlightList = NO_HIGHLIGHTS,
  plugins = [],
  toolbar = "top",
  touch = false,
}: SketchpadEditorProps) {
  const mountRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const iconsRef = useRef<Record<string, string>>({});
  const boxViews = useRef(new Set<BoxView>());
  const routeViews = useRef(new Set<RouteView>());
  // The text this editor last wrote. A `value` equal to it is its own echo,
  // and re-reading it would move the caret for nothing.
  const lastWritten = useRef<string | null>(null);
  const latest = useRef({
    onChange,
    attach,
    onFileRefused,
    mediaUrl,
    pickMedia,
    mediaKnown,
    blockTypes,
    routes,
    activeRoute,
    onOpenRoute,
    readOnly,
  });
  latest.current = {
    onChange,
    attach,
    onFileRefused,
    mediaUrl,
    pickMedia,
    mediaKnown,
    blockTypes,
    routes,
    activeRoute,
    onOpenRoute,
    readOnly,
  };
  const [, setRevision] = useState(0);

  useLayoutEffect(() => {
    const mount = mountRef.current;
    if (!mount) {
      return;
    }
    const { doc, icons } = docFromSketch(value);
    iconsRef.current = icons;
    const view = new EditorView(mount, {
      state: EditorState.create({
        doc,
        plugins: [
          inputRules({ rules: buildInputRules() }),
          keymap(buildKeymap()),
          keymap(baseKeymap),
          history(),
          dropCursor(),
          gapCursor(),
          placeholders(),
          dragHandles(),
          highlights(),
          ...plugins,
        ],
      }),
      editable: () => !latest.current.readOnly,
      attributes: {
        class: "flex flex-col gap-4 outline-none",
        "aria-label": "Sketchpad page",
      },
      nodeViews: {
        box: (node, view, getPos) =>
          new BoxView(
            node,
            view,
            getPos,
            {
              getIcons: () => iconsRef.current,
              canUpload: () => latest.current.attach !== null,
              attach: (file) =>
                latest.current.attach?.(file) ?? Promise.resolve(null),
              refuseFile: (file) => latest.current.onFileRefused?.(file),
              mediaUrl: (src) => latest.current.mediaUrl(src),
              getBlockTypes: () => latest.current.blockTypes ?? null,
              getPickMedia: () => latest.current.pickMedia ?? null,
              mediaKnown: (src) => latest.current.mediaKnown?.(src) ?? null,
            },
            boxViews.current,
          ),
        route: (node, view, getPos) =>
          new RouteView(
            node,
            view,
            getPos,
            {
              getRoutes: () => latest.current.routes ?? [],
              getActiveRoute: () => latest.current.activeRoute,
              openRoute: (route) => latest.current.onOpenRoute?.(route),
            },
            routeViews.current,
          ),
      },
      dispatchTransaction(tr: Transaction) {
        const state = view.state.apply(tr);
        view.updateState(state);
        if (tr.docChanged) {
          const text = sketchFromDoc(state.doc, iconsRef.current);
          lastWritten.current = text;
          latest.current.onChange?.(text);
        }
        setRevision((r) => r + 1);
      },
    });
    viewRef.current = view;
    lastWritten.current = value;
    // The toolbar reads the view, which did not exist on the first render.
    setRevision((r) => r + 1);
    return () => {
      view.destroy();
      viewRef.current = null;
    };
    // Mounted once: `value` changes arrive through the effect below.
  }, []);

  // Someone else changed the text: the assistant, or the Text tab.
  useEffect(() => {
    const view = viewRef.current;
    if (!view || value === lastWritten.current) {
      return;
    }
    lastWritten.current = value;
    const { doc, icons } = docFromSketch(value);
    const iconsChanged =
      JSON.stringify(icons) !== JSON.stringify(iconsRef.current);
    iconsRef.current = icons;
    const tr = replaceChanged(view.state.doc, doc, view.state.tr);
    if (tr) {
      // Not undoable as the person's own edit, and not written back: it is
      // already the text.
      tr.setMeta("addToHistory", false);
      view.updateState(view.state.apply(tr));
    }
    if (iconsChanged) {
      boxViews.current.forEach((box) => box.render());
    }
    setRevision((r) => r + 1);
  }, [value]);

  useEffect(() => {
    const view = viewRef.current;
    if (view) {
      // `editable` is read again on any update; the boxes draw their actions
      // from it, so they are told too.
      view.setProps({});
      boxViews.current.forEach((box) => box.render());
    }
  }, [readOnly]);

  // An image published, or uploaded and not yet: its URL moved. Or the
  // project's files, the site's kinds or the picker changed.
  const firstBoxRender = useRef(true);
  useEffect(() => {
    if (firstBoxRender.current) {
      firstBoxRender.current = false;
      return;
    }
    boxViews.current.forEach((box) => box.render());
  }, [mediaUrl, mediaKnown, blockTypes, pickMedia]);

  useEffect(() => {
    routeViews.current.forEach((route) => route.render());
  }, [activeRoute]);

  useEffect(() => {
    const view = viewRef.current;
    if (view) {
      view.dispatch(view.state.tr.setMeta(highlightsKey, highlightList));
    }
  }, [highlightList]);

  const view = viewRef.current;
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {view && !readOnly && toolbar === "top" && (
        <Toolbar
          view={view}
          position="top"
          touch={touch}
          routes={routes ?? []}
        />
      )}
      <div
        className={cn(
          "min-h-0 flex-1 overflow-auto bg-bg-tertiary",
          touch ? "p-2" : "p-3 sm:p-4",
        )}
      >
        <div
          ref={mountRef}
          className={cn(
            "mx-auto max-w-3xl rounded-md border border-border-primary bg-bg-primary shadow-sm",
            // Text the phone does not zoom into on focus: under 16px it does.
            touch ? "p-4 text-base" : "p-4 sm:p-6",
          )}
        />
      </div>
      {view && !readOnly && toolbar === "bottom" && (
        <Toolbar
          view={view}
          position="bottom"
          touch={touch}
          routes={routes ?? []}
        />
      )}
    </div>
  );
}

/**
 * Replaces only the part of `from` that differs from `to`, so a caret
 * outside what changed stays where it was -- the same reason the assistant's
 * edit must reach a shared document as a step, not as a new document.
 */
function replaceChanged(
  from: PMNode,
  to: PMNode,
  tr: Transaction,
): Transaction | null {
  const start = from.content.findDiffStart(to.content);
  if (start === null) {
    return null;
  }
  const end = from.content.findDiffEnd(to.content);
  if (!end) {
    return null;
  }
  let { a: endA, b: endB } = end;
  const overlap = start - Math.min(endA, endB);
  if (overlap > 0) {
    endA += overlap;
    endB += overlap;
  }
  try {
    return tr.replace(start, endA, to.slice(start, endB));
  } catch {
    return tr.replaceWith(0, from.content.size, to.content);
  }
}

function buildInputRules(): InputRule[] {
  return [
    textblockTypeInputRule(/^(#{1,3})\s$/, nodes.heading, (match) => ({
      level: match[1].length,
    })),
    // `[kind: label]` typed into an empty paragraph becomes that box.
    new InputRule(/^\[([^\]:]+)(?::\s*([^\]]*))?\]$/, (state, match, start) => {
      const $start = state.doc.resolve(start);
      if ($start.parent.type !== nodes.paragraph) {
        return null;
      }
      const kind = match[1].trim().replace(/\s+/g, "-");
      const label = match[2]?.trim();
      const box = nodes.box.create(
        { kind },
        label ? sketchSchema.text(label) : null,
      );
      const from = $start.before();
      const tr = state.tr.replaceWith(from, $start.after(), box);
      return tr.setSelection(
        TextSelection.create(tr.doc, from + 1 + box.content.size),
      );
    }),
  ];
}

function buildKeymap(): Record<string, Command> {
  return {
    "Mod-z": undo,
    "Mod-y": redo,
    "Shift-Mod-z": redo,
    // One line per box: Enter in a label goes on to a new paragraph below.
    Enter: (state, dispatch) => {
      const { $from, empty } = state.selection;
      if (!empty || $from.parent.type !== nodes.box) {
        return false;
      }
      const after = $from.after();
      if (dispatch) {
        const tr = state.tr.insert(after, nodes.paragraph.create());
        dispatch(
          tr
            .setSelection(TextSelection.create(tr.doc, after + 1))
            .scrollIntoView(),
        );
      }
      return true;
    },
    "Mod-Alt-0": setBlockType(nodes.paragraph),
    "Mod-Alt-1": setBlockType(nodes.heading, { level: 1 }),
    "Mod-Alt-2": setBlockType(nodes.heading, { level: 2 }),
    "Mod-Alt-3": setBlockType(nodes.heading, { level: 3 }),
  };
}

/** Hints in the places that are empty, as widgets so they are not text. */
function placeholders(): Plugin {
  return new Plugin({
    props: {
      decorations(state) {
        const decorations: Decoration[] = [];
        const onlyChild =
          state.doc.childCount === 1 &&
          state.doc.firstChild?.type === nodes.paragraph &&
          state.doc.firstChild.content.size === 0;
        state.doc.descendants((node, pos) => {
          const hint =
            node.type === nodes.box && node.content.size === 0
              ? "Say what goes here"
              : onlyChild && node.type === nodes.paragraph
                ? "Type the page. # for a heading, [kind: label] for a box."
                : null;
          if (hint) {
            decorations.push(
              Decoration.widget(pos + 1, () => hintElement(hint), {
                side: -1,
                ignoreSelection: true,
              }),
            );
          }
          return node.type !== nodes.box;
        });
        return DecorationSet.create(state.doc, decorations);
      },
    },
  });
}

function hintElement(text: string): HTMLElement {
  const span = document.createElement("span");
  span.className =
    "pointer-events-none absolute select-none whitespace-nowrap text-fg-tertiary";
  span.contentEditable = "false";
  span.textContent = text;
  return span;
}

// ---------------------------------------------------------------------------
// The toolbar
// ---------------------------------------------------------------------------

/** The innermost `type` around the selection, and where it starts. */
function around(
  state: EditorState,
  type: NodeType,
): { node: PMNode; pos: number } | null {
  const { $from } = state.selection;
  for (let depth = $from.depth; depth > 0; depth--) {
    if ($from.node(depth).type === type) {
      return { node: $from.node(depth), pos: $from.before(depth) };
    }
  }
  return null;
}

/** After the innermost block that holds the caret, inside its container. */
function afterCurrentBlock(state: EditorState): number {
  const { $from } = state.selection;
  for (let depth = $from.depth; depth > 0; depth--) {
    const parent = $from.node(depth - 1);
    if (
      parent.type === nodes.doc ||
      parent.type === nodes.col ||
      parent.type === nodes.row
    ) {
      return $from.after(depth);
    }
  }
  return state.doc.content.size;
}

const insertBox: Command = (state, dispatch) => {
  const at = afterCurrentBlock(state);
  if (dispatch) {
    const tr = state.tr.insert(at, nodes.box.create({ kind: "block" }));
    dispatch(
      tr.setSelection(TextSelection.create(tr.doc, at + 1)).scrollIntoView(),
    );
  }
  return true;
};

const insertColumns: Command = (state, dispatch) => {
  const at = afterCurrentBlock(state);
  if (dispatch) {
    const col = () => nodes.col.create(null, nodes.paragraph.create());
    const tr = state.tr.insert(at, nodes.row.create(null, [col(), col()]));
    // row > col > paragraph
    dispatch(
      tr.setSelection(TextSelection.create(tr.doc, at + 3)).scrollIntoView(),
    );
  }
  return true;
};

const addColumn: Command = (state, dispatch) => {
  const col = around(state, nodes.col);
  if (!col) {
    return false;
  }
  if (dispatch) {
    const at = col.pos + col.node.nodeSize;
    const tr = state.tr.insert(
      at,
      nodes.col.create(null, nodes.paragraph.create()),
    );
    dispatch(tr.setSelection(TextSelection.create(tr.doc, at + 2)));
  }
  return true;
};

const removeColumn: Command = (state, dispatch) => {
  const col = around(state, nodes.col);
  const row = around(state, nodes.row);
  if (!col || !row) {
    return false;
  }
  if (dispatch) {
    // The last column goes with its row, keeping what was in it.
    dispatch(
      row.node.childCount === 1
        ? state.tr.replaceWith(
            row.pos,
            row.pos + row.node.nodeSize,
            col.node.content,
          )
        : state.tr.delete(col.pos, col.pos + col.node.nodeSize),
    );
  }
  return true;
};

/**
 * A route divider after the top-level block the caret is in: the part of
 * the sketch below it is another page. It names the first of the site's
 * routes the sketch does not have yet, and the divider changes it.
 */
const insertRoute =
  (routes: string[]): Command =>
  (state, dispatch) => {
    const { $from } = state.selection;
    const at = $from.depth > 0 ? $from.after(1) : state.doc.content.size;
    if (dispatch) {
      const used = new Set<string>();
      state.doc.forEach((node) => {
        if (node.type === nodes.route) used.add(String(node.attrs.route));
      });
      const route = routes.find((r) => !used.has(r)) ?? "/";
      const tr = state.tr.insert(at, [
        nodes.route.create({ route }),
        nodes.paragraph.create(),
      ]);
      dispatch(
        tr.setSelection(TextSelection.create(tr.doc, at + 2)).scrollIntoView(),
      );
    }
    return true;
  };

function Toolbar({
  view,
  position,
  touch,
  routes,
}: {
  view: EditorView;
  position: "top" | "bottom";
  touch: boolean;
  routes: string[];
}) {
  const state = view.state;
  const { $from } = state.selection;
  const block = $from.parent;
  const run = (command: Command) => {
    command(view.state, view.dispatch);
    view.focus();
  };
  const isBlock = (type: NodeType, level?: number) =>
    block.type === type && (level === undefined || block.attrs.level === level);

  const groups: {
    label: string;
    icon: LucideIcon;
    command: Command;
    active?: boolean;
  }[][] = [
    [
      {
        label: "Text",
        icon: Pilcrow,
        command: setBlockType(nodes.paragraph),
        active: isBlock(nodes.paragraph),
      },
      {
        label: "Heading 1",
        icon: Heading1,
        command: setBlockType(nodes.heading, { level: 1 }),
        active: isBlock(nodes.heading, 1),
      },
      {
        label: "Heading 2",
        icon: Heading2,
        command: setBlockType(nodes.heading, { level: 2 }),
        active: isBlock(nodes.heading, 2),
      },
      {
        label: "Heading 3",
        icon: Heading3,
        command: setBlockType(nodes.heading, { level: 3 }),
        active: isBlock(nodes.heading, 3),
      },
    ],
    [
      { label: "Add a box", icon: SquareDashed, command: insertBox },
      { label: "Add columns", icon: Columns2, command: insertColumns },
      {
        label: "Add a page: what follows is about another route",
        icon: FileText,
        command: insertRoute(routes),
      },
    ],
    [
      {
        label: "Add a column after this one",
        icon: BetweenVerticalEnd,
        command: addColumn,
      },
      {
        label: "Remove this column",
        icon: Trash2,
        command: removeColumn,
      },
    ],
  ];

  return (
    <div
      role="toolbar"
      aria-label="Sketchpad"
      className={cn(
        "flex items-center gap-1 border-border-primary bg-bg-primary px-2 py-1",
        position === "top" ? "flex-wrap border-b" : "border-t",
        // One row that scrolls sideways, rather than two that eat the page.
        touch && "flex-nowrap overflow-x-auto scrollbar-none",
      )}
    >
      {groups.map((group, i) => (
        <div
          key={i}
          className={cn(
            "flex shrink-0 items-center gap-0.5",
            i > 0 && "border-l border-border-primary pl-1",
          )}
        >
          {group.map((item) => {
            const enabled = item.command(state);
            return (
              <button
                key={item.label}
                type="button"
                title={item.label}
                aria-label={item.label}
                aria-pressed={item.active}
                disabled={!enabled}
                // Keep the caret in the page (and a phone's keyboard up)
                // while the button is pressed.
                onMouseDown={(e) => e.preventDefault()}
                onPointerDown={(e) => e.preventDefault()}
                onClick={() => run(item.command)}
                className={cn(
                  "flex shrink-0 cursor-pointer items-center justify-center rounded-md text-fg-secondary hover:bg-bg-secondary hover:text-fg-primary disabled:pointer-events-none disabled:opacity-40",
                  touch ? "h-10 w-10" : "h-8 w-8",
                  item.active && "bg-bg-secondary text-fg-primary",
                )}
              >
                <item.icon className="h-4 w-4" />
              </button>
            );
          })}
        </div>
      ))}
    </div>
  );
}
