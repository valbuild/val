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
import { CompareAuthorFilterMenu, authorsInModel } from "./CompareAuthorFilter";
import { CompareAuthorsProvider } from "./CompareAuthorsContext";
import { CompareUndoBar } from "./CompareUndoBar";
import { undoWords, type UndoTone } from "./undoWords";
import {
  canUndo,
  consequenceOfUndoing,
  undoKindOf,
  undoableRowsOfModel,
} from "./undoSelection";
import { CompareColumns, CompareMobileColumns } from "./CompareColumns";
import { CompareNav } from "./CompareNav";
import {
  ComparePaneRows,
  ShowAllFieldsToggle,
  hiddenFieldCount,
} from "./ComparePaneView";
import type {
  CompareModel,
  CompareNavNode,
  ComparePane,
  CompareUndoKind,
} from "./types";

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
  /** Start in undo mode. For stories; the dialog opens read-only. */
  initialUndoMode = false,
  /** Who is looking, so the bar can say whose work a closure dragged in. */
  currentAuthorId = null,
  onUndo,
  onRevertAll,
  tone = "calm",
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  model: CompareModel;
  onSelectBasis?: (basisId: string) => void;
  forceLayout?: "desktop" | "mobile";
  mode?: "fs" | "http" | "unknown";
  now?: Date;
  initialAuthorFilter?: string | null;
  initialUndoMode?: boolean;
  currentAuthorId?: string | null;
  /** Called with everything that will go — picks and their dependents. */
  onUndo?: (kind: CompareUndoKind, rowIds: string[]) => void;
  onRevertAll?: () => void;
  /**
   * How loud undo mode is allowed to be. See `UndoTone`.
   *
   * Temporary, while the two are being compared on screen. Once one is chosen
   * this goes and the survivor is the only behaviour.
   */
  tone?: UndoTone;
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
  const [undoing, setUndoing] = useState(initialUndoMode);
  const pane = selectedId === null ? undefined : model.panes[selectedId];
  const selectRow = (id: string): void => {
    setSelectedId(id);
  };
  /*
   * Narrowing to a person moves the selection if it has to.
   *
   * The nav hides the rows that are not theirs, and the selection is not one
   * of the things it hides — so filtering to somebody whose work is elsewhere
   * left the dialog showing a change by the person it had just said it was
   * filtering out, with no row in the list to match it. The first row that
   * survives is the one the filter was asking for.
   */
  const onAuthorFilter = (next: string | null): void => {
    setAuthorFilter(next);
    if (selectedId !== null && !nodeIdShown(model, selectedId, next)) {
      setSelectedId(firstNodeId(model, next));
    }
  };
  const hidden = pane === undefined ? 0 : hiddenFieldCount(pane, authorFilter);
  const isMobile = forceLayout === "mobile";

  /*
   * Every row that could be undone, for "Discard all".
   *
   * The closure is not applied: this IS the closure — a set containing every
   * undoable row is closed over `requires` by construction, since anything a
   * member compels is also a member.
   */
  const allUndoableIds = useMemo(
    () =>
      undoableRowsOfModel(model)
        .filter((row) => canUndo(row.undo))
        .map((row) => row.id),
    [model],
  );

  /*
   * Built once and handed to whichever nav is on screen. The desktop rail and
   * the phone drawer already drifted apart once over a prop only one of them
   * was given, which is what a shared local avoids.
   */
  const navFilter =
    people.length > 1 ? (
      <CompareAuthorFilterMenu
        profiles={model.profiles}
        authorIds={people}
        selected={authorFilter}
        onSelect={onAuthorFilter}
        mode={mode}
        portalContainer={portalContainer}
      />
    ) : undefined;

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
                tone,
                consequenceOf: (rowId) =>
                  consequenceOfUndoing(rowId, model, currentAuthorId),
                onQuickUndo: (rowId) =>
                  onUndo?.(
                    undoKind,
                    consequenceOfUndoing(rowId, model, currentAuthorId).ids,
                  ),
              }
            : null,
      }}
    >
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent
          /*
           * Into the shadow root, not `document.body`.
           *
           * Radix portals to the body by default, which is OUTSIDE the shadow
           * root the Studio lives in — and `index.css` is linked into that
           * root, so the dialog came out with no styles at all: no size, no
           * centring, laid out below the fold. Storybook never showed it,
           * because there the stylesheet is on the document and the body IS
           * the styled tree; the first time this dialog was mounted in the
           * Studio it was the first time the default was wrong. The same
           * defect, and the same fix, as the discard confirm in `UtilityPanel`.
           */
          container={portalContainer}
          /*
           * Do not hand focus to the first control in the header.
           *
           * Radix focuses the first focusable child on open. That used to be
           * the basis picker, which is harmless; moving "Discard changes" to
           * the left of the header made it the destructive-mode button, so
           * opening the dialog and pressing Enter would arm a discard. Focus
           * stays on the content element itself (Radix gives it `tabIndex=-1`),
           * so the dialog is still focused for the Escape key and tabbing still
           * starts at the top.
           */
          onOpenAutoFocus={(event) => event.preventDefault()}
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
            <div className="flex min-w-0 items-center gap-3 sm:flex-1">
              <div className="min-w-0">
                <DialogTitle className="truncate text-base">
                  Review changes
                </DialogTitle>
                {/*
                 * The count describes the whole publish, so under a filter it
                 * would be describing something other than what is on screen.
                 * Rather than compute a filtered total — which the model does
                 * not carry, and which would have to agree exactly with what
                 * the panes render — the line says whose changes are shown.
                 */}
                <DialogDescription className="truncate text-xs text-fg-tertiary">
                  {authorFilter === null
                    ? /*
                       * An fs project SAVES: there is nothing outside the
                       * editor's own machine to publish to, and the button
                       * that finishes the job says "Save".
                       */
                      `${model.changeCount} ${
                        model.changeCount === 1 ? "change" : "changes"
                      } in this ${mode === "fs" ? "save" : "publish"}`
                    : `Showing changes by ${
                        model.profiles[authorFilter]?.fullName ?? authorFilter
                      }`}
                </DialogDescription>
              </div>
              {/*
               * Next to the title, not next to the close button.
               *
               * It sat between the basis picker and the dialog's own X, which
               * put the control that opens a destructive mode one target away
               * from the control that dismisses the dialog. Its own row would
               * have cost a whole band — which is what the previous pass was
               * spent removing — so it moves left instead, into space the
               * title was not using, leaving the picker and the X together.
               */}
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
                    {undoWords(undoKind).mode}
                  </span>
                  <span className="sm:hidden">
                    {undoWords(undoKind).shortMode}
                  </span>
                </Button>
              )}
            </div>
            <BasisPicker model={model} onSelectBasis={onSelectBasis} />
          </header>
          {undoing && undoKind !== null && (
            <CompareUndoBar
              kind={undoKind}
              tone={tone}
              revertAll={model.undo?.all}
              onRevertAll={onRevertAll}
              portalContainer={portalContainer}
              undoAll={{
                /*
                 * The label carries no number, deliberately — see `undoWords`.
                 * `allUndoableIds` counts undoable ROWS (a changed list entry
                 * and each changed field inside it are separate rows) and the
                 * header counts CHANGES. On this fixture that is 25 against 14,
                 * and two numbers answering one question is worse than none.
                 */
                onUndoAll: () => {
                  onUndo?.(undoKind, allUndoableIds);
                  setUndoing(false);
                },
              }}
              onCancel={() => setUndoing(false)}
            />
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
                  {pane?.description.title ?? "Nothing selected"}
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
                >
                  <ComparePaneRows
                    pane={pane}
                    showUnchanged={showUnchanged}
                    showing={showing === "left" ? "before" : "after"}
                  />
                </CompareMobileColumns>
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
                    filterSlot={navFilter}
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
                filterSlot={navFilter}
                onSelect={selectRow}
              />
              <div className="flex min-w-0 flex-1 flex-col px-4 py-3">
                {pane === undefined ? (
                  <EmptyPane />
                ) : (
                  <>
                    <PaneHeading pane={pane} />
                    <CompareColumns
                      leftSide={model.left}
                      rightSide={model.right}
                      toolbar={toggle}
                    >
                      <ComparePaneRows
                        pane={pane}
                        showUnchanged={showUnchanged}
                        showing="both"
                      />
                    </CompareColumns>
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
  /*
   * Gone entirely when there is one thing to compare against.
   *
   * That is the whole of fs mode: the content host is a directory, `ValOpsFS`
   * answers `not-supported-in-fs-mode` for history, so there are no commits —
   * the only comparison that exists is pending work against what is on disk.
   * A picker offering that alone is a control that cannot narrow anything, and
   * a control that does nothing teaches people to distrust the ones that do.
   * `CompareAuthorFilter` hides itself on the same rule.
   *
   * What it is comparing is still said: `CompareColumns` labels both sides.
   */
  if (model.basisOptions.length < 2) {
    return null;
  }
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

function firstNodeId(
  model: CompareModel,
  /** Only rows this person touched, matching what the nav will list. */
  authorFilter: string | null = null,
): string | null {
  for (const section of model.sections) {
    const found = firstOf(section.nodes, authorFilter);
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
/**
 * The name of what you opened, over where it lives.
 *
 * The heading of what you navigated to is a TITLE surface — see the rule in
 * `core/src/preview.ts` — so a module or page whose schema previews is named by
 * it here. The path below is a LOCATION and is always shown: a preview is a
 * closure over source and moves as an editor types, and in a review screen the
 * path is how someone finds the file a change is in.
 *
 * The URL earns its own place on the line when a preview supplied the title.
 * A page's URL is its identity, not a nicer name for it — two drafts called
 * "Launch" are told apart by `/blog/launch-2026` and nothing else — so a title
 * that replaced it would take that away. When no preview named the page the
 * title already IS the route, and repeating it would say one thing twice;
 * `PathHeading` draws the same distinction with `showUrlInTrail`.
 */
function PaneHeading({ pane }: { pane: ComparePane }) {
  const { description } = pane;
  const showUrl =
    description.url !== null && description.origin.title === "preview";
  /*
   * The location, unless it would only repeat the name.
   *
   * A page nobody previewed is CALLED its route, and `path` is that same
   * route — so printing both gave `/blogs/blog1` twice on two lines, which
   * spends the line on nothing and reads as though the two were different
   * things. Named pages and every data module still show it, because there
   * the name and the place are genuinely different answers.
   */
  const location = pane.path === description.title ? null : pane.path;
  const below = [showUrl ? description.url : null, location, pane.note]
    .filter(
      (part): part is string =>
        part !== null && part !== undefined && part !== "",
    )
    .join(" — ");
  return (
    <div className="mb-2 min-w-0">
      <h2 className="truncate text-sm font-medium text-fg-primary">
        {description.title}
      </h2>
      {below !== "" && (
        <p className="truncate text-xs text-fg-tertiary">{below}</p>
      )}
    </div>
  );
}

function firstOf(
  nodes: CompareNavNode[],
  authorFilter: string | null = null,
): string | null {
  for (const node of nodes) {
    if (node.change !== undefined && nodeHasAuthor(node, authorFilter)) {
      return node.id;
    }
    const child = firstOf(node.children ?? [], authorFilter);
    if (child !== null) {
      return child;
    }
  }
  return null;
}

/**
 * Whether the nav would still list this row under a filter.
 *
 * The same test `navNodeMatches` makes, and it has to stay the same one: this
 * decides what is SELECTED and that decides what is LISTED, so a disagreement
 * shows up as a dialog whose right-hand pane is not in its own left-hand list.
 * A row with no `authorIds` is kept, because it is structure rather than
 * somebody's work.
 */
function nodeHasAuthor(
  node: CompareNavNode,
  authorFilter: string | null,
): boolean {
  if (authorFilter === null) return true;
  if (node.authorIds === undefined) return true;
  return node.authorIds.includes(authorFilter);
}

/** Whether the node with this id survives the filter, anywhere in the tree. */
function nodeIdShown(
  model: CompareModel,
  id: string,
  authorFilter: string | null,
): boolean {
  const walk = (nodes: CompareNavNode[]): boolean =>
    nodes.some(
      (node) =>
        (node.id === id && nodeHasAuthor(node, authorFilter)) ||
        walk(node.children ?? []),
    );
  return model.sections.some((section) => walk(section.nodes));
}
