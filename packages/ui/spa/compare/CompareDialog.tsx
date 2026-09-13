import { useMemo, useState } from "react";
import { ChevronLeft, PanelLeft, Undo2 } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "../components/designSystem/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../components/designSystem/select";
import { Button } from "../components/designSystem/button";
import { cn } from "../components/designSystem/cn";
import { useValPortal } from "../components/ValPortalProvider";
import { CompareAuthorFilter, authorsInModel } from "./CompareAuthorFilter";
import { CompareAuthorsProvider } from "./CompareAuthorsContext";
import { CompareUndoBar } from "./CompareUndoBar";
import {
  dropRequiring,
  navRowIdsOf,
  requiresMapOfModel,
  summarizeUndo,
  toggleMany,
  undoKindOf,
} from "./undoSelection";
import { CompareColumns, CompareMobileColumns } from "./CompareColumns";
import { CompareNav } from "./CompareNav";
import {
  ComparePaneSide,
  ShowAllFieldsToggle,
  hiddenFieldCount,
} from "./ComparePaneView";
import type { CompareModel, CompareNavNode } from "./types";

/**
 * "What am I about to publish", as a room you can walk around in.
 *
 * The existing review screen (`ComparePatchSets`) answers the same question as
 * one long scroll of module cards, which is the right shape for *discarding*
 * things — every row carries its own author and its own Discard button. It is
 * the wrong shape for *reading*: with forty changes across a site there is no
 * way to ask "what happened to the blog section" without scrolling past
 * everything else, and no way to see at a glance that a page was deleted.
 *
 * So this is navigation-first. The left side is the set of things that changed
 * — pages, modules, media directories — and picking one fills the right side
 * with just that thing's diff.
 *
 * ## Reading, then undoing
 *
 * It can discard and revert, but only inside a MODE you enter on purpose. The
 * old screen's problem was that reading and discarding were the same surface,
 * with a destructive control on every row; a mode keeps the default clean and
 * makes destroying something a decision rather than a thing the cursor was
 * near. Editing is still not here — the editor is one click away, and a field
 * you can type into next to a field you cannot is the confusion
 * `ComparePatchSets` already removed once.
 *
 * Which undo is offered follows from the basis, not from taste: against
 * Published the change you want gone is a staged patch, so it is DISCARDED;
 * against a commit those changes already shipped, so the only way back is to
 * REVERT by writing the old value forward. See `CompareUndo`.
 *
 * ## Which side is which
 *
 * Left is older, right is newer, and that is never inferred from position —
 * see `CompareColumns` for the three redundant signals that carry it.
 *
 * ## What the dropdown changes
 *
 * The basis: what the right column is measured AGAINST. "Published" is the
 * default and is the publish-preview case; picking a commit turns the same
 * dialog into the history compare. That is deliberate — one compare surface,
 * two entry points — and it is why nothing below this component knows which
 * kind of comparison it is rendering.
 *
 * ## Phone
 *
 * Three regions do not fit, so the nav becomes a drawer over the diff and the
 * columns become tabs. The tab pattern is copied from `HistorySplit` rather
 * than invented, because this is the second place in the Studio that shows two
 * versions of a thing and they should not need learning twice.
 */
export function CompareDialog({
  open,
  onOpenChange,
  model,
  onSelectBasis,
  /**
   * Forced layout, for stories and screenshots.
   *
   * The component is responsive on its own; this exists so a story can render
   * the phone form in a desktop-sized Storybook frame without a viewport addon.
   */
  forceLayout,
  mode = "http",
  /** Fixed clock, so relative dates in the author popover are screenshottable. */
  now,
  /** Start filtered to one person. For stories; the dialog opens unfiltered. */
  initialAuthorFilter = null,
  /** Start in undo mode with these rows picked. For stories. */
  initialUndoPicks,
  /** Who is looking, so the bar can say whose work a closure dragged in. */
  currentAuthorId = null,
  onUndo,
  onRevertAll,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  model: CompareModel;
  onSelectBasis?: (basisId: string) => void;
  forceLayout?: "desktop" | "mobile";
  mode?: "fs" | "http" | "unknown";
  now?: Date;
  initialAuthorFilter?: string | null;
  initialUndoPicks?: string[];
  currentAuthorId?: string | null;
  /** Called with everything that will go — picks and their dependents. */
  onUndo?: (kind: "discard" | "revert", rowIds: string[]) => void;
  onRevertAll?: () => void;
}) {
  const firstId = useMemo(() => firstNodeId(model), [model]);
  const [selectedId, setSelectedId] = useState<string | null>(firstId);
  const [showUnchanged, setShowUnchanged] = useState(false);
  const [showing, setShowing] = useState<"left" | "right">("right");
  /*
   * The drawer is closed on arrival, on purpose.
   *
   * A phone opening onto a list of files has said nothing about the publish; a
   * phone opening onto the first diff has. The nav is one tap away and the
   * header names what you are looking at, so the list is never lost.
   */
  const [navOpen, setNavOpen] = useState(false);
  const [authorFilter, setAuthorFilter] = useState<string | null>(
    initialAuthorFilter,
  );
  const portalContainer = useValPortal();
  const people = useMemo(
    () => authorsInModel(model.sections),
    [model.sections],
  );
  const undoKind = undoKindOf(model);
  /*
   * Undo is a MODE, entered deliberately.
   *
   * This dialog is a reading surface — the whole reason it is navigation-first
   * is that the old review screen mixed reading with discarding and was hard to
   * redesign because of it. A destructive control on every row would put that
   * straight back. A mode keeps the default clean and makes destroying
   * something a thing you decided to do rather than a thing the cursor was
   * near.
   */
  const [undoing, setUndoing] = useState(initialUndoPicks !== undefined);
  /*
   * Only the user's OWN picks.
   *
   * What the closure compels is derived on every render rather than stored:
   * keeping both in one set would make unticking ambiguous, since a row that is
   * present because something else required it has to be told apart from one
   * that was chosen.
   */
  const [picked, setPicked] = useState<ReadonlySet<string>>(
    () => new Set(initialUndoPicks ?? []),
  );

  const pane = selectedId === null ? undefined : model.panes[selectedId];
  /*
   * Model-wide, not pane-scoped.
   *
   * It was pane-scoped and cleared on navigation while rows were the only
   * selectable thing — the reasoning being that a bar counting rows you cannot
   * see is a trap. Nav-level controls change that: a nav row spans panes by
   * construction, so the selection must too, and the nav is now where a
   * cross-pane selection is visible. The bar counts what the nav shows.
   */
  const requiresMap = useMemo(() => requiresMapOfModel(model), [model]);
  const navRowIds = useMemo(() => navRowIdsOf(model), [model]);
  const undoSummary = useMemo(
    () => summarizeUndo(picked, model, currentAuthorId),
    [picked, model, currentAuthorId],
  );
  const selectRow = (id: string): void => {
    setSelectedId(id);
  };
  const toggleRow = (rowId: string): void => {
    const requires = requiresMap;
    setPicked((prev) => {
      /*
       * Unticking anything that is currently going — whether it was picked or
       * compelled — means refusing it, and refusing a row refuses every pick
       * that forced it. `dropRequiring` walks the graph backwards; picks that
       * cannot reach this row are left alone, which is what makes "not that
       * one" possible without starting the selection over.
       */
      if (undoSummary.selected.has(rowId)) {
        return dropRequiring(prev, rowId, requires);
      }
      const next = new Set(prev);
      next.add(rowId);
      return next;
    });
  };
  const hidden = pane === undefined ? 0 : hiddenFieldCount(pane, authorFilter);
  const isMobile = forceLayout === "mobile";

  const toggle = (
    <ShowAllFieldsToggle
      showUnchanged={showUnchanged}
      onChange={setShowUnchanged}
      hiddenCount={hidden}
    />
  );

  return (
    <CompareAuthorsProvider
      value={{
        profiles: model.profiles,
        portalContainer,
        mode,
        // A fixed clock when one is given: the author popover renders relative
        // dates, and a component that reads `new Date()` itself cannot be
        // screenshotted twice and compared.
        now: now ?? new Date(),
        authorFilter,
        undo:
          undoing && undoKind !== null
            ? {
                kind: undoKind,
                selected: undoSummary.selected,
                pulledIn: undoSummary.pulledIn,
                onToggle: toggleRow,
                onToggleMany: (rowIds, next) =>
                  setPicked((prev) =>
                    toggleMany(prev, rowIds, next, requiresMap),
                  ),
              }
            : null,
      }}
    >
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent
          className={cn(
            "flex h-[85vh] max-h-[85vh] w-[95vw] max-w-[1200px] flex-col gap-0 overflow-hidden p-0",
            forceLayout === "mobile" && "h-[720px] w-[390px] max-w-[390px]",
          )}
        >
          {/*
           * Stacked below `sm`, and `pr-10` at every width.
           *
           * Both are about the same corner. `DialogContent` draws its own close
           * button absolutely in the top right, so a header that runs to the edge
           * puts the basis dropdown underneath it; and a single row put the title
           * and the dropdown in the same flex line, where on a phone the title
           * lost and rendered as "R." over "1…".
           */}
          <header className="flex shrink-0 flex-col gap-2 border-b border-border-primary px-4 py-3 pr-10 sm:flex-row sm:items-center sm:gap-3">
            <div className="min-w-0 sm:flex-1">
              <DialogTitle className="truncate text-base">
                Review changes
              </DialogTitle>
              {/*
               * The count describes the whole publish, so under a filter it
               * would be describing something other than what is on screen.
               * Rather than compute a filtered total — which the model does
               * not carry, and which would have to agree exactly with what the
               * panes render — the line says whose changes are shown instead.
               */}
              <DialogDescription className="truncate text-xs text-fg-tertiary">
                {authorFilter === null
                  ? `${model.changeCount} ${
                      model.changeCount === 1 ? "change" : "changes"
                    } in this publish`
                  : `Showing changes by ${
                      model.profiles[authorFilter]?.fullName ?? authorFilter
                    }`}
              </DialogDescription>
            </div>
            {/*
             * One row below `sm`, three flex children above it.
             *
             * `sm:contents` dissolves this wrapper at desktop so the picker and
             * the button go back to being direct children of the header. Below
             * that it groups them, which fixes two things at once: the header
             * was stacking into three rows on a phone and eating half the
             * screen, and the button — a stretched flex child in a column —
             * came out full width and centred, reading as a stray link rather
             * than as a control next to the one it belongs beside.
             */}
            <div className="flex min-w-0 items-center gap-2 sm:contents">
              <BasisPicker model={model} onSelectBasis={onSelectBasis} />
              {undoKind !== null && !undoing && (
                <Button
                  size="sm"
                  /*
                   * `secondary`, not `outline`. The `outline` variant in this
                   * design system is `border-transparent` — its own comment
                   * says the border "has always been transparent" — so the
                   * button rendered as a bare link, which is the wrong weight
                   * for the thing that opens a destructive mode.
                   */
                  variant="secondary"
                  className="shrink-0"
                  onClick={() => setUndoing(true)}
                >
                  <Undo2 size={13} aria-hidden />
                  {/*
                   * The label is the verb, not the noun, and on a phone it is
                   * the verb alone: "Discard changes" beside a basis picker
                   * that already says what is being compared is two words of
                   * repetition in the tightest row in the dialog.
                   */}
                  <span className="hidden sm:inline">
                    {undoKind === "discard" ? "Discard changes" : "Revert"}
                  </span>
                  <span className="sm:hidden">
                    {undoKind === "discard" ? "Discard" : "Revert"}
                  </span>
                </Button>
              )}
            </div>
          </header>
          {undoing && undoKind !== null && (
            <CompareUndoBar
              kind={undoKind}
              summary={undoSummary}
              pickedCount={picked.size}
              profiles={model.profiles}
              revertAll={model.undo?.all}
              onRevertAll={onRevertAll}
              portalContainer={portalContainer}
              onCancel={() => {
                setUndoing(false);
                setPicked(new Set());
              }}
              onConfirm={() => {
                onUndo?.(undoKind, [...undoSummary.selected]);
                setUndoing(false);
                setPicked(new Set());
              }}
            />
          )}
          {people.length > 1 && (
            <div className="shrink-0 border-b border-border-primary px-4 py-2">
              <CompareAuthorFilter
                profiles={model.profiles}
                authorIds={people}
                selected={authorFilter}
                onSelect={setAuthorFilter}
                mode={mode}
              />
            </div>
          )}

          {isMobile ? (
            <div className="relative flex min-h-0 flex-1 flex-col px-3 py-3">
              <div className="mb-2 flex min-w-0 items-center gap-2">
                <button
                  onClick={() => setNavOpen(true)}
                  className="flex shrink-0 items-center gap-1 rounded border border-border-primary px-2 py-1 text-xs text-fg-secondary"
                >
                  <PanelLeft size={12} aria-hidden />
                  Changes
                </button>
                <span className="min-w-0 flex-1 truncate text-sm font-medium text-fg-primary">
                  {pane?.title ?? "Nothing selected"}
                </span>
              </div>
              {pane === undefined ? (
                <EmptyPane />
              ) : (
                <CompareMobileColumns
                  leftSide={model.left}
                  rightSide={model.right}
                  showing={showing}
                  onShow={setShowing}
                  toolbar={toggle}
                  left={
                    <ComparePaneSide
                      pane={pane}
                      side="before"
                      showUnchanged={showUnchanged}
                    />
                  }
                  right={
                    <ComparePaneSide
                      pane={pane}
                      side="after"
                      showUnchanged={showUnchanged}
                    />
                  }
                />
              )}
              {navOpen && (
                <div className="absolute inset-0 z-20 flex flex-col bg-bg-primary">
                  <div className="flex items-center gap-2 border-b border-border-primary px-3 py-2">
                    <button
                      onClick={() => setNavOpen(false)}
                      className="flex items-center gap-1 text-sm text-fg-secondary"
                    >
                      <ChevronLeft size={14} aria-hidden />
                      Back
                    </button>
                  </div>
                  <CompareNav
                    className="flex-1 px-2 py-2"
                    sections={model.sections}
                    selectedId={selectedId}
                    authorFilter={authorFilter}
                    navRowIds={navRowIds}
                    onSelect={(id) => {
                      selectRow(id);
                      setNavOpen(false);
                    }}
                  />
                </div>
              )}
            </div>
          ) : (
            <div className="flex min-h-0 flex-1">
              <CompareNav
                className="w-[260px] shrink-0 border-r border-border-primary px-2 py-3"
                sections={model.sections}
                selectedId={selectedId}
                authorFilter={authorFilter}
                navRowIds={navRowIds}
                onSelect={selectRow}
              />
              <div className="flex min-w-0 flex-1 flex-col px-4 py-3">
                {pane === undefined ? (
                  <EmptyPane />
                ) : (
                  <>
                    <div className="mb-2 min-w-0">
                      <h2 className="truncate text-sm font-medium text-fg-primary">
                        {pane.title}
                      </h2>
                      {pane.subtitle !== undefined && (
                        <p className="truncate text-xs text-fg-tertiary">
                          {pane.subtitle}
                        </p>
                      )}
                    </div>
                    <CompareColumns
                      leftSide={model.left}
                      rightSide={model.right}
                      toolbar={toggle}
                      left={
                        <ComparePaneSide
                          pane={pane}
                          side="before"
                          showUnchanged={showUnchanged}
                        />
                      }
                      right={
                        <ComparePaneSide
                          pane={pane}
                          side="after"
                          showUnchanged={showUnchanged}
                        />
                      }
                    />
                  </>
                )}
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </CompareAuthorsProvider>
  );
}

function BasisPicker({
  model,
  onSelectBasis,
}: {
  model: CompareModel;
  onSelectBasis?: (basisId: string) => void;
}) {
  return (
    <div className="flex min-w-0 flex-1 items-center gap-2 sm:flex-none">
      {/*
       * The label is dropped below `sm`. In a row that now also holds the undo
       * button, "Comparing against" is the first thing that can go: the
       * dropdown's own two lines already say what is being compared and when.
       *
       * `sm` and not a narrower breakpoint because there is no narrower one —
       * this config defines only `md` and `2xl` on top of the defaults.
       */}
      <span className="hidden shrink-0 text-xs text-fg-tertiary sm:inline">
        Comparing against
      </span>
      <Select
        value={model.selectedBasisId}
        onValueChange={(value) => onSelectBasis?.(value)}
      >
        {/*
         * `flex-1`, not `w-full`, below `sm`.
         *
         * The picker is a flex row holding a `shrink-0` label and this trigger,
         * so `w-full` meant "100% of the row" — label plus trigger then added up
         * to more than the row and the trigger hung off the right edge of the
         * dialog. `w-auto` is there to neutralise the `w-[calc(100%-8px)]` the
         * shared `SelectTrigger` sets for its usual full-width use.
         */}
        <SelectTrigger className="h-auto min-h-8 w-auto min-w-0 flex-1 py-1 text-xs sm:w-[210px] sm:flex-none">
          {/*
           * A wrapper, because `SelectValue` drops `className`.
           *
           * Radix renders `Select.Value` as its own span and does not forward
           * the prop — measured: the element comes out with `class=""`. So the
           * constraint has to go on an element we own.
           *
           * It is needed at all because `SelectTrigger` is
           * `flex items-center justify-between`, which makes the value a flex
           * child, and a flex child's `min-width` defaults to `auto` — it
           * refuses to shrink below its content. A long commit message then
           * made the value 665px wide inside a 210px button: `truncate` on the
           * label had no bounded width to work against, the text ran out of
           * the dialog and under the close button, and the chevron was
           * squeezed to zero.
           */}
          <span className="min-w-0 flex-1 overflow-hidden text-left">
            <SelectValue />
          </span>
        </SelectTrigger>
        <SelectContent>
          {model.basisOptions.map((option) => (
            <SelectItem key={option.id} value={option.id}>
              {/*
               * `title` on both lines, because the trigger shows one clipped
               * line of what may be a paragraph of commit message. Without it
               * the only way to read the rest is to guess.
               */}
              <span className="block truncate" title={option.label}>
                {option.label}
              </span>
              {option.caption !== undefined && (
                <span className="block truncate text-xs text-fg-tertiary">
                  {option.caption}
                </span>
              )}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}

function EmptyPane() {
  return (
    <div className="flex flex-1 items-center justify-center">
      <p className="text-sm text-fg-tertiary">
        Pick something on the left to see what changed.
      </p>
    </div>
  );
}

function firstNodeId(model: CompareModel): string | null {
  for (const section of model.sections) {
    const found = firstOf(section.nodes);
    if (found !== null) {
      return found;
    }
  }
  return null;
}

/**
 * The first row that has a pane, depth first.
 *
 * Not simply `sections[0].nodes[0]`: the first row is often a folder, which is
 * structure and has nothing to show. Opening onto a blank right-hand side would
 * make the dialog look broken on arrival.
 */
function firstOf(nodes: CompareNavNode[]): string | null {
  for (const node of nodes) {
    if (node.change !== undefined) {
      return node.id;
    }
    const child = firstOf(node.children ?? []);
    if (child !== null) {
      return child;
    }
  }
  return null;
}
