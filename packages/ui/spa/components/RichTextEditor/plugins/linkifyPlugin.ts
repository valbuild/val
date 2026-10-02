import {
  Plugin,
  PluginKey,
  TextSelection,
  type EditorState,
  type Transaction,
} from "prosemirror-state";
import { Decoration, DecorationSet, type EditorView } from "prosemirror-view";
import { keydownHandler } from "prosemirror-keymap";
import type { MarkType, ResolvedPos } from "prosemirror-model";
import {
  applyLinkFindings,
  describeFinding,
  EMPTY_LINK_SCAN,
  findUrlsInText,
  isSingleUrl,
  resolveUrl,
  scanLinks,
  type LinkContext,
  type LinkFinding,
  type LinkScan,
} from "../linkify";
import type { EditorLinkCatalogItem } from "../types";
import type { LinkHelper } from "./formattingToolbarShared";

/**
 * Links from URLs: on paste, while typing, on ⌘K, and for the "Link all" bar.
 *
 * The rules of WHAT a URL links to are in `../linkify.ts`; this is only WHEN.
 *
 * - **Paste.** Pasted text has its URLs linked at once, and a single URL pasted
 *   over a selection links the selection instead of replacing it. The paste and
 *   the linking are one history event, so ⌘Z takes both back; the chip the
 *   editor shows afterwards takes back the linking alone.
 * - **Typing.** A URL becomes a link when the space or Enter after it is
 *   typed, the way every mail client does it.
 * - **⌘K.** On a bare URL, links it. On a link, or a selection, opens the same
 *   editor the toolbar button does.
 *
 * A URL on this site that has no page is never linked by any of these. It is
 * left as text and highlighted as an error, which is the one place a missing
 * page is visible before it is published.
 */

export const linkifyPluginKey = new PluginKey<LinkifyState>("linkify");

export interface AutoLinked {
  /** Changes whenever a new paste links something, so a UI can restart its timer. */
  id: number;
  ranges: { from: number; to: number }[];
}

interface LinkifyState {
  scan: LinkScan;
  decorations: DecorationSet;
  autoLinked: AutoLinked | null;
}

type LinkifyMeta =
  | { type: "rescan" }
  | { type: "auto-linked"; ranges: { from: number; to: number }[] }
  | { type: "clear-auto-linked" };

export interface LinkifyPluginOptions {
  linkType: MarkType;
  getContext: () => LinkContext;
  getLinkCatalog: () => EditorLinkCatalogItem[] | undefined;
  linkHelper: LinkHelper;
  readOnly: boolean;
  /** Called from the view whenever the scan or the auto-linked ranges change. */
  onChange?: (
    state: { scan: LinkScan; autoLinked: AutoLinked | null },
    view: EditorView,
  ) => void;
}

/**
 * Class names match `errorPlugin`'s, and the `data-error-*` attributes are what
 * `errorTooltipPlugin` looks for — so hovering a missing page shows the same
 * tooltip every other error in the editor does, with the message from `title`.
 */
const MISSING_PAGE_CLASS =
  "border-b-2 border-border-error-primary bg-bg-error-secondary/20";

function buildDecorations(state: EditorState, scan: LinkScan): DecorationSet {
  if (scan.missing.length === 0) return DecorationSet.empty;
  return DecorationSet.create(
    state.doc,
    scan.missing.map((finding) =>
      Decoration.inline(finding.from, finding.to, {
        class: MISSING_PAGE_CLASS,
        title: describeFinding(finding),
        "data-error-kind": "link.missing-page",
        "data-error-path": `link.missing-page:${finding.from}`,
      }),
    ),
  );
}

function sameFindings(a: LinkFinding[], b: LinkFinding[]): boolean {
  return (
    a.length === b.length &&
    a.every(
      (finding, index) =>
        finding.from === b[index].from &&
        finding.to === b[index].to &&
        finding.url === b[index].url &&
        JSON.stringify(finding.resolution) ===
          JSON.stringify(b[index].resolution),
    )
  );
}

function sameScan(a: LinkScan, b: LinkScan): boolean {
  return (
    sameFindings(a.fixable, b.fixable) &&
    sameFindings(a.missing, b.missing) &&
    sameFindings(a.notAllowed, b.notAllowed)
  );
}

let nextAutoLinkedId = 1;

/** What `textBetween` puts in place of an inline leaf, which no URL contains. */
const OBJECT_REPLACEMENT = String.fromCharCode(0xfffc);

/** Every position `tr` wrote to, as one range in the document after it. */
function changedRange(tr: Transaction): { from: number; to: number } | null {
  let from = Infinity;
  let to = -Infinity;
  tr.mapping.maps.forEach((map, index) => {
    const rest = tr.mapping.slice(index + 1);
    map.forEach((_oldStart, _oldEnd, newStart, newEnd) => {
      from = Math.min(from, rest.map(newStart, -1));
      to = Math.max(to, rest.map(newEnd, 1));
    });
  });
  return from <= to ? { from, to } : null;
}

function mapThrough(
  range: { from: number; to: number },
  trs: readonly Transaction[],
): { from: number; to: number } {
  let { from, to } = range;
  for (const tr of trs) {
    from = tr.mapping.map(from, -1);
    to = tr.mapping.map(to, 1);
  }
  return { from, to };
}

function overlaps(
  finding: LinkFinding,
  range: { from: number; to: number },
): boolean {
  return finding.from < range.to && finding.to > range.from;
}

/**
 * The link mark's full extent around `$pos`, which may span several text
 * nodes when part of the link is bold.
 */
function linkRangeAt(
  $pos: ResolvedPos,
  linkType: MarkType,
): { from: number; to: number } | null {
  const parent = $pos.parent;
  const start = $pos.start();
  const markAt = (index: number) => {
    const child =
      index >= 0 && index < parent.childCount ? parent.child(index) : null;
    return child && child.isText ? linkType.isInSet(child.marks) : null;
  };
  const index = $pos.index();
  let hit = markAt(index);
  let hitIndex = index;
  if (!hit && $pos.textOffset === 0) {
    hit = markAt(index - 1);
    hitIndex = index - 1;
  }
  if (!hit) return null;
  const href = hit.attrs.href;
  let first = hitIndex;
  while (markAt(first - 1)?.attrs.href === href) first--;
  let last = hitIndex;
  while (markAt(last + 1)?.attrs.href === href) last++;
  let from = start;
  for (let i = 0; i < first; i++) from += parent.child(i).nodeSize;
  let to = from;
  for (let i = first; i <= last; i++) to += parent.child(i).nodeSize;
  return { from, to };
}

/**
 * The URL ending exactly at `pos`, when it should become a link — for the
 * typing rule, which fires on the character AFTER the URL.
 */
function urlEndingAt(
  state: EditorState,
  pos: number,
  options: LinkifyPluginOptions,
): { from: number; to: number; href: string } | null {
  const $pos = state.doc.resolve(pos);
  if (!$pos.parent.isTextblock || $pos.parent.type.spec.code) return null;
  // U+FFFC for inline leaves so a URL cannot run through an image. The text
  // is checked against the document below, because an inline node WITH
  // content (a button) does not take one character per position.
  const before = $pos.parent.textBetween(
    0,
    $pos.parentOffset,
    undefined,
    OBJECT_REPLACEMENT,
  );
  const urls = findUrlsInText(before);
  const last = urls[urls.length - 1];
  if (!last) return null;
  // Only a URL right before the cursor, give or take the punctuation that
  // closed the sentence around it.
  if (/[^.,;:!?)\]}*_~']/.test(before.slice(last.end))) return null;
  const to = pos - (before.length - last.end);
  const from = to - last.url.length;
  if (from < $pos.start()) return null;
  if (state.doc.textBetween(from, to) !== last.url) return null;
  if (state.doc.rangeHasMark(from, to, options.linkType)) return null;
  const code = state.schema.marks.code;
  if (code && state.doc.rangeHasMark(from, to, code)) return null;
  const resolution = resolveUrl(last.url, options.getContext());
  if (resolution?.status !== "linkable") return null;
  return { from, to, href: resolution.href };
}

export function createLinkifyPlugin(options: LinkifyPluginOptions): Plugin {
  const { linkType, linkHelper, readOnly } = options;

  const openLinkEditor = (view: EditorView) => {
    const catalog = options.getLinkCatalog();
    if (catalog && catalog.length > 0) {
      linkHelper.showCatalogPicker(view, linkType, catalog);
    } else {
      linkHelper.showUrlEditor(view, linkType);
    }
  };

  /** ⌘K. */
  const linkCommand = (view: EditorView): boolean => {
    const { state } = view;
    const { selection } = state;
    const scan = linkifyPluginKey.getState(state)?.scan ?? EMPTY_LINK_SCAN;

    if (selection.empty) {
      const bare = scan.fixable.find(
        (finding) =>
          finding.source === "text" &&
          finding.from <= selection.from &&
          selection.from <= finding.to,
      );
      if (bare) {
        view.dispatch(applyLinkFindings(state.tr, [bare], linkType));
        return true;
      }
      const link = linkRangeAt(selection.$from, linkType);
      if (link) {
        view.dispatch(
          state.tr.setSelection(
            TextSelection.create(state.doc, link.from, link.to),
          ),
        );
        openLinkEditor(view);
      }
      // Swallowed either way: ⌘K / Ctrl+K is "focus the address bar" in some
      // browsers, and the editor claiming it only sometimes is worse.
      return true;
    }

    const selected = state.doc.textBetween(selection.from, selection.to);
    // Only text that is not a link yet. A link whose TEXT reads as a URL may go
    // somewhere else (`https://ssb.no` → `/report`), and relinking it to its
    // text would replace that destination without a word.
    if (
      isSingleUrl(selected) &&
      !state.doc.rangeHasMark(selection.from, selection.to, linkType)
    ) {
      const resolution = resolveUrl(selected, options.getContext());
      if (resolution?.status === "linkable") {
        view.dispatch(
          state.tr
            .removeMark(selection.from, selection.to, linkType)
            .addMark(
              selection.from,
              selection.to,
              linkType.create({ href: resolution.href }),
            ),
        );
        return true;
      }
    }
    openLinkEditor(view);
    return true;
  };

  const handleKeyDown = keydownHandler({
    "Mod-k": (_state, _dispatch, view) => (view ? linkCommand(view) : false),
  });

  return new Plugin<LinkifyState>({
    key: linkifyPluginKey,
    state: {
      init(_config, state): LinkifyState {
        const scan = scanLinks(state.doc, state.schema, options.getContext());
        return {
          scan,
          decorations: buildDecorations(state, scan),
          autoLinked: null,
        };
      },
      apply(tr, prev, _oldState, newState): LinkifyState {
        const meta = tr.getMeta(linkifyPluginKey) as LinkifyMeta | undefined;
        let { scan, decorations, autoLinked } = prev;
        if (tr.docChanged || meta?.type === "rescan") {
          const next = scanLinks(
            newState.doc,
            newState.schema,
            options.getContext(),
          );
          // The same findings keep the same object, so the bar under the
          // field is not re-rendered on every keystroke of a field with no
          // URLs in it — which is nearly every keystroke.
          if (!sameScan(scan, next)) scan = next;
          // Always rebuilt: the positions are the new document's.
          decorations = buildDecorations(newState, scan);
        }
        if (meta?.type === "auto-linked") {
          autoLinked = { id: nextAutoLinkedId++, ranges: meta.ranges };
        } else if (meta?.type === "clear-auto-linked") {
          autoLinked = null;
        } else if (autoLinked && tr.docChanged) {
          autoLinked = {
            id: autoLinked.id,
            ranges: autoLinked.ranges.map((range) => ({
              from: tr.mapping.map(range.from, 1),
              to: tr.mapping.map(range.to, -1),
            })),
          };
        }
        return { scan, decorations, autoLinked };
      },
    },

    appendTransaction(transactions, _oldState, newState) {
      if (readOnly) return null;
      let range: { from: number; to: number } | null = null;
      for (let index = 0; index < transactions.length; index++) {
        const tr = transactions[index];
        if (tr.getMeta("uiEvent") !== "paste" || !tr.docChanged) continue;
        const changed = changedRange(tr);
        if (!changed) continue;
        const mapped = mapThrough(changed, transactions.slice(index + 1));
        range = range
          ? {
              from: Math.min(range.from, mapped.from),
              to: Math.max(range.to, mapped.to),
            }
          : mapped;
      }
      if (range === null) return null;
      const pasted = range;
      const scan = linkifyPluginKey.getState(newState)?.scan;
      const findings = (scan?.fixable ?? []).filter((finding) =>
        overlaps(finding, pasted),
      );
      if (findings.length === 0) return null;
      const meta: LinkifyMeta = {
        type: "auto-linked",
        ranges: findings.map(({ from, to }) => ({ from, to })),
      };
      return applyLinkFindings(newState.tr, findings, linkType).setMeta(
        linkifyPluginKey,
        meta,
      );
    },

    view(editorView) {
      let last = linkifyPluginKey.getState(editorView.state);
      options.onChange?.(
        {
          scan: last?.scan ?? EMPTY_LINK_SCAN,
          autoLinked: last?.autoLinked ?? null,
        },
        editorView,
      );
      return {
        update(view) {
          const next = linkifyPluginKey.getState(view.state);
          if (
            next &&
            (next.scan !== last?.scan || next.autoLinked !== last?.autoLinked)
          ) {
            last = next;
            options.onChange?.(
              { scan: next.scan, autoLinked: next.autoLinked },
              view,
            );
          }
        },
      };
    },

    props: {
      decorations(state) {
        return linkifyPluginKey.getState(state)?.decorations;
      },

      handleKeyDown(view, event) {
        if (readOnly) return false;
        if (handleKeyDown(view, event)) return true;
        if (
          event.key === "Enter" &&
          !event.shiftKey &&
          !event.metaKey &&
          !event.ctrlKey &&
          !event.altKey &&
          view.state.selection.empty
        ) {
          const url = urlEndingAt(
            view.state,
            view.state.selection.from,
            options,
          );
          if (url) {
            view.dispatch(
              view.state.tr.addMark(
                url.from,
                url.to,
                linkType.create({ href: url.href }),
              ),
            );
          }
        }
        // Never handled: Enter still does whatever Enter does.
        return false;
      },

      handleTextInput(view, from, to, text) {
        if (readOnly || from !== to || !/^\s$/.test(text)) return false;
        const url = urlEndingAt(view.state, from, options);
        if (!url) return false;
        const tr = view.state.tr.addMark(
          url.from,
          url.to,
          linkType.create({ href: url.href }),
        );
        // The link mark is not inclusive, so the space does not join it.
        tr.insertText(text, from, to);
        view.dispatch(tr);
        return true;
      },

      handlePaste(view, event, slice) {
        if (readOnly) return false;
        const text =
          event.clipboardData?.getData("text/plain") ||
          slice.content.textBetween(0, slice.content.size, "\n");
        if (!isSingleUrl(text)) return false;
        const { selection } = view.state;
        if (
          selection.empty ||
          !(selection instanceof TextSelection) ||
          !selection.$from.sameParent(selection.$to) ||
          selection.$from.parent.type.spec.code ||
          // Inline code is a sample, as a code block is: pasting over it
          // replaces it, like any paste, rather than linking it.
          (view.state.schema.marks.code !== undefined &&
            view.state.doc.rangeHasMark(
              selection.from,
              selection.to,
              view.state.schema.marks.code,
            ))
        ) {
          return false;
        }
        // Replacing one URL with another is an ordinary paste; the pasted one
        // is linked by `appendTransaction` like any other.
        if (
          isSingleUrl(view.state.doc.textBetween(selection.from, selection.to))
        ) {
          return false;
        }
        const resolution = resolveUrl(text, options.getContext());
        if (resolution?.status !== "linkable") return false;
        view.dispatch(
          view.state.tr
            .removeMark(selection.from, selection.to, linkType)
            .addMark(
              selection.from,
              selection.to,
              linkType.create({ href: resolution.href }),
            ),
        );
        return true;
      },
    },
  });
}

/** "Link all" / "Review": link the given findings of the CURRENT scan. */
export function applyLinkFixes(
  view: EditorView,
  select: (finding: LinkFinding) => boolean = () => true,
): void {
  const state = linkifyPluginKey.getState(view.state);
  const linkType = view.state.schema.marks.link;
  if (!state || !linkType) return;
  const findings = state.scan.fixable.filter(select);
  if (findings.length === 0) return;
  view.dispatch(applyLinkFindings(view.state.tr, findings, linkType));
}

/** "Keep as text" on the chip: undo the linking a paste did, and nothing else. */
export function unlinkAutoLinked(view: EditorView): void {
  const state = linkifyPluginKey.getState(view.state);
  const linkType = view.state.schema.marks.link;
  if (!state?.autoLinked || !linkType) return;
  const tr = view.state.tr;
  for (const { from, to } of state.autoLinked.ranges) {
    if (from < to) tr.removeMark(from, to, linkType);
  }
  const meta: LinkifyMeta = { type: "clear-auto-linked" };
  view.dispatch(tr.setMeta(linkifyPluginKey, meta));
}

export function clearAutoLinked(view: EditorView): void {
  const meta: LinkifyMeta = { type: "clear-auto-linked" };
  view.dispatch(view.state.tr.setMeta(linkifyPluginKey, meta));
}

/** Re-run the scan after the site, the routes or the catalog changed. */
export function rescanLinks(view: EditorView): void {
  const meta: LinkifyMeta = { type: "rescan" };
  view.dispatch(view.state.tr.setMeta(linkifyPluginKey, meta));
}
