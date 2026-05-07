import { Plugin, PluginKey } from "prosemirror-state";
import { Decoration, DecorationSet } from "prosemirror-view";
import { ChangeSet } from "prosemirror-changeset";
import { StepMap } from "prosemirror-transform";
import type { Node as PMNode } from "prosemirror-model";

export const diffPluginKey = new PluginKey<DiffState>("diff");

interface DiffState {
  baseDoc: PMNode | null;
  changeSet: ChangeSet | null;
  decorations: DecorationSet;
}

export function createDiffPlugin(): Plugin<DiffState> {
  return new Plugin<DiffState>({
    key: diffPluginKey,
    state: {
      init(): DiffState {
        return {
          baseDoc: null,
          changeSet: null,
          decorations: DecorationSet.empty,
        };
      },
      apply(tr, state, _oldState, newState): DiffState {
        const newBaseDoc = tr.getMeta(diffPluginKey)?.baseDoc;

        if (newBaseDoc !== undefined) {
          if (newBaseDoc === null) {
            return {
              baseDoc: null,
              changeSet: null,
              decorations: DecorationSet.empty,
            };
          }
          const cs = ChangeSet.create(newBaseDoc);
          const maps: StepMap[] = [];
          computeDiffMaps(newBaseDoc, newState.doc, maps);
          const updated =
            maps.length > 0 ? cs.addSteps(newState.doc, maps, null) : cs;
          return {
            baseDoc: newBaseDoc,
            changeSet: updated,
            decorations: buildDecorations(updated, newState.doc, newBaseDoc),
          };
        }

        if (!state.baseDoc || !state.changeSet) {
          return state;
        }

        if (!tr.docChanged) {
          return {
            ...state,
            decorations: state.decorations.map(tr.mapping, tr.doc),
          };
        }

        const maps = tr.steps.map((step) => step.getMap());
        const updated = state.changeSet.addSteps(tr.doc, maps, null);
        return {
          ...state,
          changeSet: updated,
          decorations: buildDecorations(updated, tr.doc, state.baseDoc),
        };
      },
    },
    props: {
      decorations(state) {
        return (
          diffPluginKey.getState(state)?.decorations ?? DecorationSet.empty
        );
      },
    },
  });
}

function computeDiffMaps(baseDoc: PMNode, currentDoc: PMNode, maps: StepMap[]) {
  const baseSize = baseDoc.content.size;
  const curSize = currentDoc.content.size;
  if (baseSize !== curSize || !baseDoc.eq(currentDoc)) {
    maps.push(new StepMap([0, baseSize, curSize]));
  }
}

function buildDecorations(
  changeSet: ChangeSet,
  doc: PMNode,
  baseDoc: PMNode,
): DecorationSet {
  const decorations: Decoration[] = [];

  for (const change of changeSet.changes) {
    if (change.fromB < change.toB) {
      const from = Math.max(0, change.fromB);
      const to = Math.min(doc.content.size, change.toB);
      if (from < to) {
        decorations.push(
          Decoration.inline(from, to, {
            class: "bg-bg-brand-primary/30",
          }),
        );
      }
    }

    if (change.fromA < change.toA && change.deleted.length > 0) {
      const pos = Math.min(change.fromB, doc.content.size);
      const fromA = Math.max(0, change.fromA);
      const toA = Math.min(baseDoc.content.size, change.toA);
      const deletedText =
        fromA < toA ? baseDoc.textBetween(fromA, toA, " ") : "";
      if (deletedText.length > 0) {
        const widget = document.createElement("span");
        widget.className =
          "bg-bg-error-primary line-through text-fg-error-primary opacity-60";
        widget.textContent = deletedText;
        decorations.push(Decoration.widget(pos, widget, { side: -1 }));
      }
    }
  }

  return DecorationSet.create(doc, decorations);
}
