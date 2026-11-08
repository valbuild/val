import { Plugin, PluginKey } from "prosemirror-state";
import { Decoration, DecorationSet } from "prosemirror-view";
import { sketchLinePositions } from "./sketchpadDoc";

export type SketchHighlightColor =
  | "red"
  | "amber"
  | "green"
  | "blue"
  | "purple";

/**
 * Blocks the assistant points at, and why: "these two need code mode". It
 * reads the sketch as text, so it names them by line, and the editor marks
 * the blocks those lines were written from. The person can clear it.
 */
export type SketchHighlight = {
  id: string;
  /** 1-based lines of the sketch text, as the assistant read it. */
  lines: number[];
  color: SketchHighlightColor;
  /** Shown beside the blocks, and in the bar that clears them. */
  note: string;
};

/** Strong enough to find on a busy page, light enough to read through. */
export const HIGHLIGHT_COLORS: Record<
  SketchHighlightColor,
  { line: string; fill: string; text: string }
> = {
  red: { line: "#dc2626", fill: "rgba(220, 38, 38, 0.08)", text: "#b91c1c" },
  amber: { line: "#d97706", fill: "rgba(217, 119, 6, 0.10)", text: "#b45309" },
  green: { line: "#16a34a", fill: "rgba(22, 163, 74, 0.08)", text: "#15803d" },
  blue: { line: "#2563eb", fill: "rgba(37, 99, 235, 0.08)", text: "#1d4ed8" },
  purple: {
    line: "#9333ea",
    fill: "rgba(147, 51, 234, 0.08)",
    text: "#7e22ce",
  },
};

export const highlightsKey = new PluginKey<SketchHighlight[]>("highlights");

/**
 * The highlights as node decorations. They follow the document: a line names
 * a block where the highlight was made, and the decoration then moves with
 * that block as the person types above it.
 */
export function highlights(): Plugin<SketchHighlight[]> {
  return new Plugin<SketchHighlight[]>({
    key: highlightsKey,
    state: {
      init: () => [],
      apply: (tr, value) => tr.getMeta(highlightsKey) ?? value,
    },
    props: {
      decorations(state) {
        const list = highlightsKey.getState(state) ?? [];
        if (list.length === 0) {
          return DecorationSet.empty;
        }
        const positions = sketchLinePositions(state.doc);
        const decorations: Decoration[] = [];
        const seen = new Set<number>();
        for (const highlight of list) {
          const color = HIGHLIGHT_COLORS[highlight.color];
          highlight.lines.forEach((line, i) => {
            const pos = positions.get(line);
            const node = pos === undefined ? null : state.doc.nodeAt(pos);
            if (pos === undefined || !node || seen.has(pos)) {
              return;
            }
            seen.add(pos);
            decorations.push(
              Decoration.node(pos, pos + node.nodeSize, {
                style: `outline: 2px solid ${color.line}; outline-offset: 4px; background-color: ${color.fill}; border-radius: 6px;`,
                "data-highlight": highlight.id,
              }),
            );
            // The note once, above the first block it marks.
            if (i === 0) {
              decorations.push(
                Decoration.widget(
                  pos,
                  () => noteElement(highlight.note, color.text),
                  {
                    side: -1,
                    ignoreSelection: true,
                    key: `note-${highlight.id}-${pos}`,
                  },
                ),
              );
            }
          });
        }
        return DecorationSet.create(state.doc, decorations);
      },
    },
  });
}

function noteElement(note: string, color: string): HTMLElement {
  const el = document.createElement("div");
  el.contentEditable = "false";
  el.className =
    "pointer-events-none -mb-2 select-none text-[11px] font-medium leading-tight";
  el.style.color = color;
  el.textContent = note;
  return el;
}
