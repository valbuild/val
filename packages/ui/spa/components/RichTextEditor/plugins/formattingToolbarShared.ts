import type { EditorView } from "prosemirror-view";
import { toggleMark, setBlockType, wrapIn, lift } from "prosemirror-commands";
import type { Schema, MarkType, NodeType } from "prosemirror-model";
import { NodeSelection, type EditorState } from "prosemirror-state";
import { wrapInList, liftListItem } from "prosemirror-schema-list";
import { nodeViewPosToJsonPath } from "../pmPosToJsonPath";
import {
  type EditorLinkCatalogItem,
  type EditorButtonVariant,
  type EditorStyleConfig,
  type ResolvedEditorFeatures,
  type LinkPickerState,
  HEADING_FEATURE_KEYS,
} from "../types";

const CUSTOM_STYLE_PREFIX = "custom_style_";

export interface ToolbarButtonDef {
  label: string;
  title: string;
  markType: MarkType;
}

export function getFormattingButtons(
  schema: Schema,
  features?: ResolvedEditorFeatures,
): ToolbarButtonDef[] {
  const buttons: ToolbarButtonDef[] = [];
  if (schema.marks.bold && (!features || features.bold))
    buttons.push({
      label: "B",
      title: "Bold (Ctrl+B)",
      markType: schema.marks.bold,
    });
  if (schema.marks.italic && (!features || features.italic))
    buttons.push({
      label: "I",
      title: "Italic (Ctrl+I)",
      markType: schema.marks.italic,
    });
  if (schema.marks.strikethrough && (!features || features.strikethrough))
    buttons.push({
      label: "S",
      title: "Strikethrough (Ctrl+Shift+X)",
      markType: schema.marks.strikethrough,
    });
  if (schema.marks.code && (!features || features.code))
    buttons.push({
      label: "<>",
      title: "Code (Ctrl+E)",
      markType: schema.marks.code,
    });
  if (schema.marks.link && (!features || features.link))
    buttons.push({
      label: "\u{1F517}",
      title: "Link",
      markType: schema.marks.link,
    });
  return buttons;
}

export function getCustomStyleButtons(
  schema: Schema,
  styleConfig?: EditorStyleConfig,
): ToolbarButtonDef[] {
  if (!styleConfig) return [];
  const buttons: ToolbarButtonDef[] = [];
  for (const [name, def] of Object.entries(styleConfig)) {
    const markName = `${CUSTOM_STYLE_PREFIX}${name}`;
    const markType = schema.marks[markName];
    if (markType) {
      buttons.push({
        label: def.label,
        title: def.label,
        markType,
      });
    }
  }
  return buttons;
}

export interface ListButtonDef {
  label: string;
  title: string;
  nodeType: NodeType;
}

export function getListButtons(
  schema: Schema,
  features?: ResolvedEditorFeatures,
): ListButtonDef[] {
  const buttons: ListButtonDef[] = [];
  if (schema.nodes.bullet_list && (!features || features.bulletList))
    buttons.push({
      label: "\u2022",
      title: "Bullet list (Ctrl+Shift+8)",
      nodeType: schema.nodes.bullet_list,
    });
  if (schema.nodes.ordered_list && (!features || features.orderedList))
    buttons.push({
      label: "1.",
      title: "Ordered list (Ctrl+Shift+9)",
      nodeType: schema.nodes.ordered_list,
    });
  return buttons;
}

export function isListActive(state: EditorState, listType: NodeType): boolean {
  const { $from } = state.selection;
  for (let d = $from.depth; d > 0; d--) {
    if ($from.node(d).type === listType) return true;
  }
  return false;
}

function findAncestorList(
  state: EditorState,
  schema: Schema,
): {
  depth: number;
  node: ReturnType<EditorState["selection"]["$from"]["node"]>;
} | null {
  const { $from } = state.selection;
  for (let d = $from.depth; d > 0; d--) {
    const node = $from.node(d);
    if (
      node.type === schema.nodes.bullet_list ||
      node.type === schema.nodes.ordered_list
    ) {
      return { depth: d, node };
    }
  }
  return null;
}

function convertBlockToParagraph(view: EditorView, schema: Schema): void {
  const { state } = view;
  const { $from } = state.selection;
  const parent = $from.parent;
  if (parent.type !== schema.nodes.paragraph && parent.type.isTextblock) {
    setBlockType(schema.nodes.paragraph)(state, view.dispatch, view);
  }
}

export function toggleList(
  listType: NodeType,
  schema: Schema,
): (
  state: EditorState,
  dispatch?: EditorView["dispatch"],
  view?: EditorView,
) => boolean {
  return (state, dispatch, view) => {
    if (isListActive(state, listType)) {
      const listItem = schema.nodes.list_item;
      if (listItem) {
        return liftListItem(listItem)(state, dispatch);
      }
      return false;
    }

    const ancestor = findAncestorList(state, schema);
    if (ancestor) {
      if (dispatch) {
        const { $from } = state.selection;
        const pos = $from.before(ancestor.depth);
        const tr = state.tr.setNodeMarkup(pos, listType);
        dispatch(tr);
      }
      return true;
    }

    if (view) {
      const { $from } = state.selection;
      const parent = $from.parent;
      if (parent.type !== schema.nodes.paragraph && parent.type.isTextblock) {
        convertBlockToParagraph(view, schema);
        return wrapInList(listType)(view.state, view.dispatch);
      }
    }

    return wrapInList(listType)(state, dispatch);
  };
}

export function isMarkActive(state: EditorState, type: MarkType): boolean {
  const { from, $from, to, empty } = state.selection;
  if (empty) return !!type.isInSet(state.storedMarks || $from.marks());
  return state.doc.rangeHasMark(from, to, type);
}

// --- Block type selector ---

export interface BlockTypeDef {
  value: string;
  label: string;
  nodeType: NodeType;
  attrs?: Record<string, unknown>;
}

export function getBlockTypeItems(
  schema: Schema,
  features?: ResolvedEditorFeatures,
): BlockTypeDef[] {
  const items: BlockTypeDef[] = [];

  items.push({
    value: "paragraph",
    label: "Normal",
    nodeType: schema.nodes.paragraph,
  });

  if (schema.nodes.heading) {
    for (let level = 1; level <= 3; level++) {
      if (!features || features[HEADING_FEATURE_KEYS[level - 1]]) {
        items.push({
          value: `heading${level}`,
          label: `Heading ${level}`,
          nodeType: schema.nodes.heading,
          attrs: { level },
        });
      }
    }
  }

  if (schema.nodes.code_block && (!features || features.codeBlock)) {
    items.push({
      value: "code_block",
      label: "Code",
      nodeType: schema.nodes.code_block,
    });
  }

  if (schema.nodes.blockquote && (!features || features.blockquote)) {
    items.push({
      value: "blockquote",
      label: "Quote",
      nodeType: schema.nodes.blockquote,
    });
  }

  if (schema.nodes.details && (!features || features.details)) {
    items.push({
      value: "details",
      label: "Details",
      nodeType: schema.nodes.details,
    });
  }

  return items;
}

export function detectCurrentBlockType(
  state: EditorState,
  items: BlockTypeDef[],
): string {
  const { $from } = state.selection;

  for (let d = $from.depth; d > 0; d--) {
    const node = $from.node(d);
    if (node.type.name === "details") return "details";
    if (node.type.name === "blockquote") return "blockquote";
  }

  const parent = $from.parent;
  if (parent.type.name === "heading") {
    const level = parent.attrs.level as number;
    const match = items.find((i) => i.value === `heading${level}`);
    if (match) return match.value;
  }
  if (parent.type.name === "code_block") return "code_block";

  return "paragraph";
}

export function applyBlockType(
  view: EditorView,
  schema: Schema,
  target: BlockTypeDef,
): void {
  const { state, dispatch } = view;

  if (target.value === "blockquote") {
    wrapIn(schema.nodes.blockquote)(state, dispatch);
    return;
  }

  if (target.value === "details") {
    insertDetailsBlock(view, schema, "details");
    return;
  }

  const { $from } = state.selection;
  let inWrapper = false;
  for (let d = $from.depth; d > 0; d--) {
    const name = $from.node(d).type.name;
    if (name === "blockquote" || name === "details") {
      inWrapper = true;
      break;
    }
  }

  if (inWrapper) {
    lift(state, (tr) => {
      const lifted = view.state.apply(tr);
      view.updateState(lifted);
      setBlockType(target.nodeType, target.attrs)(
        view.state,
        view.dispatch,
        view,
      );
    });
    return;
  }

  setBlockType(target.nodeType, target.attrs)(state, dispatch, view);
}

export interface RenderToolbarOptions {
  showBlockTypeSelect?: boolean;
}

export interface LinkHelperOptions {
  getLinkCatalog?: () => EditorLinkCatalogItem[] | undefined;
  getPortalContainer?: () => HTMLElement | null;
  onPickerStateChange: (state: LinkPickerState | null) => void;
  isPickerOpen: () => boolean;
}

export interface LinkHelper {
  handleLinkToggle(view: EditorView, markType: MarkType): void;
  showCatalogPicker(
    view: EditorView,
    markType: MarkType,
    catalog: EditorLinkCatalogItem[],
  ): void;
  showUrlEditor(view: EditorView, markType: MarkType): void;
  closePicker(): void;
  isPickerOpen(): boolean;
  destroy(): void;
}

function computePickerAnchor(
  view: EditorView,
  from: number,
  useViewportCoords: boolean,
): { left: number; top: number } | null {
  const coords = view.coordsAtPos(from);
  if (useViewportCoords) {
    return {
      left: Math.max(0, coords.left),
      top: coords.bottom + 4,
    };
  }
  const parent = view.dom.parentElement;
  if (!parent) return null;
  const parentRect = parent.getBoundingClientRect();
  return {
    left: Math.max(0, coords.left - parentRect.left),
    top: coords.bottom - parentRect.top + 4,
  };
}

export function createLinkHelper(options: LinkHelperOptions): LinkHelper {
  function closePicker() {
    options.onPickerStateChange(null);
  }

  function showCatalogPicker(
    view: EditorView,
    markType: MarkType,
    catalog: EditorLinkCatalogItem[],
  ) {
    const { $from, from, to } = view.state.selection;
    const existingLink =
      markType.isInSet($from.marks()) ??
      ($from.nodeAfter ? markType.isInSet($from.nodeAfter.marks) : null);
    const currentHref: string | null = existingLink
      ? (existingLink.attrs.href as string).trim()
      : null;

    const useViewport = !!options.getPortalContainer?.();
    const anchorRect = computePickerAnchor(view, from, useViewport);
    if (!anchorRect) return;

    options.onPickerStateChange({
      kind: "catalog",
      anchorRect,
      savedFrom: from,
      savedTo: to,
      currentHref,
      catalog,
    });
  }

  function showUrlEditor(view: EditorView, markType: MarkType) {
    const { $from, from, to } = view.state.selection;
    const existingLink =
      markType.isInSet($from.marks()) ??
      ($from.nodeAfter ? markType.isInSet($from.nodeAfter.marks) : null);
    const currentHref: string | null = existingLink
      ? (existingLink.attrs.href as string).trim()
      : null;

    const useViewport = !!options.getPortalContainer?.();
    const anchorRect = computePickerAnchor(view, from, useViewport);
    if (!anchorRect) return;

    options.onPickerStateChange({
      kind: "url",
      anchorRect,
      savedFrom: from,
      savedTo: to,
      currentHref,
      isNewLink: !existingLink,
    });
  }

  function handleLinkToggle(view: EditorView, markType: MarkType) {
    const { state } = view;
    const catalog = options.getLinkCatalog?.();

    if (catalog && catalog.length > 0) {
      if (options.isPickerOpen()) {
        closePicker();
        return;
      }
      showCatalogPicker(view, markType, catalog);
      return;
    }

    if (isMarkActive(state, markType)) {
      toggleMark(markType)(state, view.dispatch, view);
      return;
    }

    if (options.isPickerOpen()) {
      closePicker();
      return;
    }
    showUrlEditor(view, markType);
  }

  return {
    handleLinkToggle,
    showCatalogPicker,
    showUrlEditor,
    closePicker,
    isPickerOpen: () => options.isPickerOpen(),
    destroy: closePicker,
  };
}

function isButtonNode(
  node: { type: { name: string } } | null | undefined,
): boolean {
  return (
    node?.type.name === "button_atom" || node?.type.name === "button_editable"
  );
}

function findButtonAtCursor(
  state: EditorState,
): { pos: number; node: ReturnType<EditorState["doc"]["nodeAt"]> } | null {
  const { $from } = state.selection;

  if (
    state.selection instanceof NodeSelection &&
    isButtonNode(state.selection.node)
  ) {
    return { pos: state.selection.from, node: state.selection.node };
  }

  if (isButtonNode($from.parent)) {
    const start = $from.before($from.depth);
    return { pos: start, node: $from.parent };
  }

  if (isButtonNode($from.nodeBefore)) {
    const pos = $from.pos - $from.nodeBefore!.nodeSize;
    return { pos, node: $from.nodeBefore };
  }

  if (isButtonNode($from.nodeAfter)) {
    return { pos: $from.pos, node: $from.nodeAfter };
  }

  return null;
}

export function insertButton(
  view: EditorView,
  schema: Schema,
  variant: EditorButtonVariant,
  href?: string,
): void {
  const isAtom = variant.children === false;
  const nodeType = isAtom
    ? schema.nodes.button_atom
    : schema.nodes.button_editable;
  if (!nodeType) return;

  const attrs: Record<string, unknown> = { variant: variant.variant };
  if (!isAtom && href) {
    attrs.href = href;
  }
  const node = isAtom
    ? nodeType.create(attrs)
    : nodeType.create(attrs, variant.label ? [schema.text(variant.label)] : []);

  const existing = findButtonAtCursor(view.state);
  if (existing && existing.node) {
    const tr = view.state.tr.replaceWith(
      existing.pos,
      existing.pos + existing.node.nodeSize,
      node,
    );
    view.dispatch(tr);
  } else {
    const { from } = view.state.selection;
    const tr = view.state.tr.insert(from, node);
    view.dispatch(tr);
  }
}

export function insertImage(
  view: EditorView,
  schema: Schema,
  src: string,
  opts?: {
    previewUrl?: string;
    width?: number;
    height?: number;
    mimeType?: string;
  },
): string[] | null {
  const imageType = schema.nodes.image;
  if (!imageType) return null;
  const node = imageType.create({
    src,
    alt: "",
    previewUrl: opts?.previewUrl ?? null,
    width: opts?.width ?? null,
    height: opts?.height ?? null,
    mimeType: opts?.mimeType ?? null,
  });
  const { from } = view.state.selection;
  const tr = view.state.tr.insert(from, node);
  view.dispatch(tr);
  const jsonPath = nodeViewPosToJsonPath(view.state.doc, from);
  return jsonPath ? [...jsonPath, "src"] : null;
}

export function insertDetailsBlock(
  view: EditorView,
  schema: Schema,
  variant: string,
): void {
  const detailsType = schema.nodes.details;
  const summaryType = schema.nodes.details_summary;
  if (!detailsType || !summaryType) return;

  const { state } = view;
  const { $from } = state.selection;

  const summaryNode = summaryType.create(null, []);
  const paragraph = schema.nodes.paragraph.create();
  const detailsNode = detailsType.create({ variant }, [summaryNode, paragraph]);

  const insertPos = $from.end($from.depth === 0 ? 1 : $from.depth) + 1;
  const tr = state.tr.insert(insertPos, detailsNode);
  view.dispatch(tr);
  view.focus();
}
