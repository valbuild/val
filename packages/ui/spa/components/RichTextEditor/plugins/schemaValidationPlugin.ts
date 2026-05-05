import { Plugin, PluginKey } from "prosemirror-state";
import type { EditorView } from "prosemirror-view";
import type { Node as PMNode, Schema } from "prosemirror-model";
import type { EditorError, EditorErrorFix } from "../types";
import { type ResolvedEditorFeatures, HEADING_FEATURE_KEYS } from "../types";
import { resolvePointerToPos } from "./resolvePointer";

export const schemaValidationPluginKey = new PluginKey<SchemaValidationState>(
  "schemaValidation",
);

interface SchemaValidationState {
  errors: EditorError[];
}

const NODE_TYPE_TO_FEATURE: Record<string, keyof ResolvedEditorFeatures> = {
  bullet_list: "bulletList",
  ordered_list: "orderedList",
  blockquote: "blockquote",
  code_block: "codeBlock",
  details: "details",
  details_summary: "details",
  hard_break: "hardBreak",
  button_atom: "button",
  button_editable: "button",
  image: "image",
};

const MARK_TYPE_TO_FEATURE: Record<string, keyof ResolvedEditorFeatures> = {
  bold: "bold",
  italic: "italic",
  strikethrough: "strikethrough",
  code: "code",
  link: "link",
};

const NODE_LABEL: Record<string, string> = {
  heading: "Heading",
  bullet_list: "Bullet list",
  ordered_list: "Ordered list",
  blockquote: "Blockquote",
  code_block: "Code block",
  details: "Details",
  details_summary: "Details",
  hard_break: "Hard break",
  button_atom: "Button",
  button_editable: "Button",
  image: "Image",
};

const MARK_LABEL: Record<string, string> = {
  bold: "Bold",
  italic: "Italic",
  strikethrough: "Strikethrough",
  code: "Code",
  link: "Link",
};

const NODE_FIXES: Record<string, EditorErrorFix[]> = {
  heading: [
    { id: "schema.convert-to-paragraph", label: "Convert to paragraph" },
  ],
  bullet_list: [
    { id: "schema.convert-to-paragraphs", label: "Convert to paragraphs" },
  ],
  ordered_list: [
    { id: "schema.convert-to-paragraphs", label: "Convert to paragraphs" },
  ],
  blockquote: [
    { id: "schema.convert-to-paragraphs", label: "Convert to paragraphs" },
  ],
  code_block: [
    { id: "schema.convert-to-paragraph", label: "Convert to paragraph" },
  ],
  details: [
    { id: "schema.convert-to-paragraphs", label: "Convert to paragraphs" },
  ],
};

const MARK_FIXES: Record<string, EditorErrorFix[]> = {
  bold: [{ id: "schema.remove-formatting", label: "Remove formatting" }],
  italic: [{ id: "schema.remove-formatting", label: "Remove formatting" }],
  strikethrough: [
    { id: "schema.remove-formatting", label: "Remove formatting" },
  ],
  code: [{ id: "schema.remove-formatting", label: "Remove formatting" }],
  link: [{ id: "schema.remove-link", label: "Remove link" }],
};

function pathToPointer(indices: number[]): string {
  return "/" + indices.join("/children/");
}

function validateNode(
  node: PMNode,
  features: ResolvedEditorFeatures,
  path: number[],
  errors: EditorError[],
): void {
  node.forEach((child, _offset, index) => {
    const childPath = [...path, index];

    if (child.type.name === "heading") {
      const level = child.attrs.level as number;
      const key = HEADING_FEATURE_KEYS[level - 1];
      if (key && !features[key]) {
        const fixes = NODE_FIXES[child.type.name];
        errors.push({
          path: pathToPointer(childPath),
          message: `Heading ${level} is not allowed by the current schema`,
          kind: "schema.violation",
          ...(fixes && { fixes }),
        });
        return;
      }
    }

    const feature = NODE_TYPE_TO_FEATURE[child.type.name];
    if (feature && !features[feature]) {
      const label = NODE_LABEL[child.type.name] ?? child.type.name;
      const fixes = NODE_FIXES[child.type.name];
      errors.push({
        path: pathToPointer(childPath),
        message: `${label} is not allowed by the current schema`,
        kind: "schema.violation",
        ...(fixes && { fixes }),
      });
      return;
    }

    if (child.isText && child.marks.length > 0) {
      const pointer = pathToPointer(childPath);
      for (const mark of child.marks) {
        const markFeature = MARK_TYPE_TO_FEATURE[mark.type.name];
        if (markFeature && !features[markFeature]) {
          const label = MARK_LABEL[mark.type.name] ?? mark.type.name;
          const fixes = MARK_FIXES[mark.type.name];
          errors.push({
            path: pointer,
            message: `${label} is not allowed by the current schema`,
            kind: "schema.violation",
            ...(fixes && { fixes }),
          });
        }
      }
      return;
    }

    if (child.childCount > 0) {
      validateNode(child, features, childPath, errors);
    }
  });
}

function validateDocument(
  doc: PMNode,
  features: ResolvedEditorFeatures,
): EditorError[] {
  const errors: EditorError[] = [];
  validateNode(doc, features, [], errors);
  return errors;
}

export function applySchemaViolationFix(
  view: EditorView,
  path: string,
  fixId: string,
): boolean {
  const { state } = view;
  const { doc, schema } = state;

  const resolved = resolvePointerToPos(path, doc);
  if (!resolved) return false;

  const { from, to } = resolved;
  const node = doc.nodeAt(from);
  if (!node) return false;

  if (fixId === "schema.convert-to-paragraph") {
    return convertToParagraph(view, node, from, to, schema);
  }

  if (fixId === "schema.convert-to-paragraphs") {
    return convertToParagraphs(view, node, from, to, schema);
  }

  if (fixId === "schema.remove-formatting" || fixId === "schema.remove-link") {
    return removeMarksInRange(view, from, to);
  }

  return false;
}

function convertToParagraph(
  view: EditorView,
  node: PMNode,
  from: number,
  to: number,
  schema: Schema,
): boolean {
  const textContent = extractTextContent(node);
  const paragraph = schema.node(
    "paragraph",
    null,
    textContent.length > 0 ? [schema.text(textContent)] : [],
  );
  const tr = view.state.tr.replaceWith(from, to, paragraph);
  view.dispatch(tr);
  return true;
}

function convertToParagraphs(
  view: EditorView,
  node: PMNode,
  from: number,
  to: number,
  schema: Schema,
): boolean {
  const paragraphs: PMNode[] = [];
  collectParagraphs(node, schema, paragraphs);

  if (paragraphs.length === 0) {
    paragraphs.push(schema.node("paragraph"));
  }

  const tr = view.state.tr.replaceWith(from, to, paragraphs);
  view.dispatch(tr);
  return true;
}

function collectParagraphs(
  node: PMNode,
  schema: Schema,
  result: PMNode[],
): void {
  if (node.isTextblock) {
    const text = extractTextContent(node);
    result.push(
      schema.node(
        "paragraph",
        null,
        text.length > 0 ? [schema.text(text)] : [],
      ),
    );
    return;
  }

  node.forEach((child) => {
    collectParagraphs(child, schema, result);
  });
}

function removeMarksInRange(
  view: EditorView,
  from: number,
  to: number,
): boolean {
  let tr = view.state.tr;
  const node = view.state.doc.nodeAt(from);
  if (!node || !node.isText) return false;

  for (const mark of node.marks) {
    tr = tr.removeMark(from, to, mark.type);
  }

  view.dispatch(tr);
  return true;
}

function extractTextContent(node: PMNode): string {
  return node.textContent;
}

export function createSchemaValidationPlugin(
  features: ResolvedEditorFeatures,
): Plugin<SchemaValidationState> {
  return new Plugin<SchemaValidationState>({
    key: schemaValidationPluginKey,
    state: {
      init(_config, state): SchemaValidationState {
        return { errors: validateDocument(state.doc, features) };
      },
      apply(tr, pluginState, _oldState, newState): SchemaValidationState {
        if (tr.docChanged) {
          return { errors: validateDocument(newState.doc, features) };
        }
        return pluginState;
      },
    },
  });
}
