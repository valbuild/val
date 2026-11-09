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

type HighlightsState = {
  list: SketchHighlight[];
  /** Where each highlight's blocks are, by id: mapped as the doc changes. */
  positions: Map<string, number[]>;
};

export const highlightsKey = new PluginKey<HighlightsState>("highlights");

/**
 * The highlights as node decorations. A line names a block where the
 * highlight was made; from then on the block is followed by its position,
 * so typing above it does not move the highlight onto another block.
 */
export function highlights(): Plugin<HighlightsState> {
  return new Plugin<HighlightsState>({
    key: highlightsKey,
    state: {
      init: () => ({ list: [], positions: new Map() }),
      apply: (tr, value) => {
        const list: SketchHighlight[] | undefined = tr.getMeta(highlightsKey);
        if (list) {
          // New or changed highlights are placed by line; ones already
          // placed keep following their blocks.
          const lines = sketchLinePositions(tr.doc);
          const positions = new Map<string, number[]>();
          for (const highlight of list) {
            const known = value.list.find(
              (h) =>
                h.id === highlight.id &&
                h.lines.join(",") === highlight.lines.join(","),
            );
            const kept = known ? value.positions.get(highlight.id) : undefined;
            positions.set(
              highlight.id,
              kept
                ? kept.flatMap((pos) => {
                    const mapped = tr.mapping.mapResult(pos);
                    return mapped.deleted ? [] : [mapped.pos];
                  })
                : highlight.lines.flatMap((line) => {
                    const pos = lines.get(line);
                    return pos === undefined ? [] : [pos];
                  }),
            );
          }
          return { list, positions };
        }
        if (!tr.docChanged || value.list.length === 0) {
          return value;
        }
        const positions = new Map<string, number[]>();
        value.positions.forEach((all, id) =>
          positions.set(
            id,
            all.flatMap((pos) => {
              const mapped = tr.mapping.mapResult(pos);
              return mapped.deleted ? [] : [mapped.pos];
            }),
          ),
        );
        return { list: value.list, positions };
      },
    },
    props: {
      decorations(state) {
        const value = highlightsKey.getState(state);
        if (!value || value.list.length === 0) {
          return DecorationSet.empty;
        }
        const decorations: Decoration[] = [];
        const seen = new Set<number>();
        for (const highlight of value.list) {
          const color = HIGHLIGHT_COLORS[highlight.color];
          (value.positions.get(highlight.id) ?? []).forEach((pos, i) => {
            const node = state.doc.nodeAt(pos);
            if (!node || seen.has(pos)) {
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
