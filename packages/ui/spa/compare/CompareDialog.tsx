import { useMemo, useState } from "react";
import { ChevronLeft, PanelLeft } from "lucide-react";
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
import { cn } from "../components/designSystem/cn";
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
 * with just that thing's diff. Nothing here can discard or edit: this view is
 * for understanding a publish before making it, and mixing a destructive
 * control into a reading surface is what made the old screen hard to redesign.
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
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  model: CompareModel;
  onSelectBasis?: (basisId: string) => void;
  forceLayout?: "desktop" | "mobile";
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

  const pane = selectedId === null ? undefined : model.panes[selectedId];
  const hidden = pane === undefined ? 0 : hiddenFieldCount(pane);
  const isMobile = forceLayout === "mobile";

  const toggle = (
    <ShowAllFieldsToggle
      showUnchanged={showUnchanged}
      onChange={setShowUnchanged}
      hiddenCount={hidden}
    />
  );

  return (
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
            <DialogDescription className="truncate text-xs text-fg-tertiary">
              {`${model.changeCount} ${
                model.changeCount === 1 ? "change" : "changes"
              } in this publish`}
            </DialogDescription>
          </div>
          <BasisPicker model={model} onSelectBasis={onSelectBasis} />
        </header>

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
                  onSelect={(id) => {
                    setSelectedId(id);
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
              onSelect={setSelectedId}
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
    <div className="flex min-w-0 items-center gap-2">
      <span className="shrink-0 text-xs text-fg-tertiary">
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
