import { Plugin, PluginKey, type EditorState } from "prosemirror-state";
import { Decoration, DecorationSet } from "prosemirror-view";
import type { Node as PMNode } from "prosemirror-model";
import type { EditorError } from "../types";
import { schemaValidationPluginKey } from "./schemaValidationPlugin";
import { resolvePointerToPos } from "./resolvePointer";

export { resolvePointerToPos } from "./resolvePointer";

export const errorPluginKey = new PluginKey<ErrorState>("errors");

interface ErrorState {
  externalErrors: EditorError[];
  errors: EditorError[];
  decorations: DecorationSet;
  errorKindClassName: Record<string, string>;
}

function getSchemaErrors(state: EditorState): EditorError[] {
  return schemaValidationPluginKey.getState(state)?.errors ?? [];
}

export function createErrorPlugin(): Plugin<ErrorState> {
  return new Plugin<ErrorState>({
    key: errorPluginKey,
    state: {
      init(_config, state): ErrorState {
        const schemaErrors = getSchemaErrors(state);
        return {
          externalErrors: [],
          errors: schemaErrors,
          errorKindClassName: {},
          decorations: buildErrorDecorations(schemaErrors, state.doc, {}),
        };
      },
      apply(tr, state, _oldState, newState): ErrorState {
        const meta = tr.getMeta(errorPluginKey);
        if (meta) {
          const externalErrors: EditorError[] =
            meta.errors ?? state.externalErrors;
          const errorKindClassName: Record<string, string> =
            meta.errorKindClassName ?? state.errorKindClassName;
          const schemaErrors = getSchemaErrors(newState);
          const errors = [...externalErrors, ...schemaErrors];
          return {
            externalErrors,
            errors,
            errorKindClassName,
            decorations: buildErrorDecorations(
              errors,
              newState.doc,
              errorKindClassName,
            ),
          };
        }

        if (tr.docChanged) {
          const schemaErrors = getSchemaErrors(newState);
          const errors = [...state.externalErrors, ...schemaErrors];
          return {
            ...state,
            errors,
            decorations: buildErrorDecorations(
              errors,
              newState.doc,
              state.errorKindClassName,
            ),
          };
        }

        return state;
      },
    },
    props: {
      decorations(state) {
        return (
          errorPluginKey.getState(state)?.decorations ?? DecorationSet.empty
        );
      },
    },
  });
}

function buildErrorDecorations(
  errors: EditorError[],
  doc: PMNode,
  errorKindClassName: Record<string, string>,
): DecorationSet {
  if (errors.length === 0) return DecorationSet.empty;

  const decorations: Decoration[] = [];

  for (const error of errors) {
    const resolved = resolvePointerToPos(error.path, doc);
    if (!resolved) continue;

    const { from, to } = resolved;
    const kindClass = errorKindClassName[error.kind] ?? "";
    const baseClass =
      "border-b-2 border-border-error-primary bg-bg-error-secondary/20";
    const className = kindClass ? `${baseClass} ${kindClass}` : baseClass;

    decorations.push(
      Decoration.inline(from, to, {
        class: className,
        title: error.message,
        "data-error-kind": error.kind,
        "data-error-path": error.path,
      }),
    );
  }

  return DecorationSet.create(doc, decorations);
}
