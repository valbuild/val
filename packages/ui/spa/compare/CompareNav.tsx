import { useState, type ReactNode } from "react";
import {
  Braces,
  ChevronDown,
  ChevronRight,
  File,
  FileText,
  Files,
  Folder,
  Image as ImageIcon,
  Images,
} from "lucide-react";
import { cn } from "../components/designSystem/cn";
import { ChangeKindIcon, changeKindLabel } from "./ChangeKindIcon";
import type {
  CompareNavKind,
  CompareNavNode,
  CompareNavSection,
} from "./types";

/**
 * What changed, as a tree you can walk.
 *
 * This is NOT the Studio's nav menu with a filter on it, and the difference is
 * the point: the nav menu answers "what is there", so it shows every page and
 * every module. This answers "what is in this publish", so a page nobody
 * touched is absent entirely — and a page that was DELETED is present, which
 * the real nav can never show because the thing is gone.
 *
 * Consequently the counts here are change counts, not error counts, and a
 * folder exists only as far as it is on the way to something that changed.
 *
 * Media sits in the same tree rather than in a separate surface. An added image
 * and an added page are the same kind of statement about this publish, and
 * splitting them would mean two places to look before you trust that you have
 * seen everything.
 *
 * ## This tree is a LOCATION, so it carries no previews
 *
 * Deliberately, and it will keep reading worse than it could. The rule is in
 * `core/src/preview.ts`: a preview is a TITLE and belongs where a value is
 * shown as a thing — a heading, a card, a list row — and a location is made of
 * path segments. This is the Pages tree of a publish, so its rows are routes,
 * keys and file names, exactly like the Explorer and the real Pages panel.
 *
 * Two reasons it must stay that way. A trail of titles names things and locates
 * none of them: `Content / Forfattere / Theodor René Carlsen` cannot be typed
 * into a URL bar or matched against the file someone is looking at. And a
 * preview is a closure over source, so a nav built from titles would reorder
 * and rename itself as an editor types — in a screen whose whole job is to
 * hold still while you read it.
 *
 * The pane heading and the list rows on the right ARE title surfaces, and they
 * do carry previews. That asymmetry is the rule working, not an inconsistency.
 */

/**
 * The panels' icons, on every row.
 *
 * `File` for a page and `Braces` for a module are what `PagesPanel` and
 * `DataPanel` draw, so a row here and the same row under Pages or Data are
 * recognisably the same thing.
 *
 * Rows with children get an icon too, and that is a deliberate DIVERGENCE from
 * the panels rather than an oversight. Both of them note that "the leading slot
 * is one icon wide, and a second icon in it overlaps the label" — but that is a
 * fact about THEIR layout, where the chevron and the icon compete for one slot.
 * This nav puts the chevron in its own button, outside the row's navigate
 * button, precisely so a folder can be expanded without being selected. There
 * are two slots here, so the constraint that produced the rule does not hold,
 * and copying the rule without its premise left every folder and gallery
 * unmarked.
 *
 * A gallery is split by what it holds: `Images` for an `s.imageset()` and
 * `Files` for an `s.fileset()`, because the two are different modules and the
 * row is the only place that says which. Their entries follow `MediaPanel` —
 * an image icon for an image, `FileText` for anything else.
 */
const KIND_ICONS: Record<CompareNavKind, typeof FileText> = {
  page: File,
  folder: Folder,
  module: Braces,
  "media-dir": Images,
  "media-fileset": Files,
  "media-file": ImageIcon,
  "media-doc": FileText,
};

/**
 * Whether a row survives the author filter.
 *
 * A row with no `authorIds` is KEPT — it is structure (a folder) or a node the
 * adapter has not attributed, and hiding it would silently shorten the tree
 * rather than narrow it. A folder therefore has to carry the union of its
 * children's authors, which it does.
 */
function navNodeMatches(
  node: CompareNavNode,
  authorFilter: string | null,
): boolean {
  if (authorFilter === null) return true;
  if (node.authorIds === undefined) return true;
  return node.authorIds.includes(authorFilter);
}

export function CompareNav({
  sections,
  selectedId,
  onSelect,
  authorFilter = null,
  filterSlot,
  className,
}: {
  sections: CompareNavSection[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  /** Show only rows this person touched. Null shows everyone's. */
  authorFilter?: string | null;
  /**
   * Controls that filter this list — currently the author menu.
   *
   * A slot rather than a prop for the filter itself, because the nav should not
   * have to know what can narrow it. What it does know is that anything which
   * narrows the list belongs ON the list, which is the whole argument for
   * moving the author filter here out of a band of its own.
   */
  filterSlot?: ReactNode;
  className?: string;
}) {
  return (
    <nav
      className={cn("min-w-0 overflow-y-auto", className)}
      aria-label="Changed content"
    >
      {filterSlot !== undefined && (
        <div className="px-1 pb-3">{filterSlot}</div>
      )}
      {sections.map((section) => {
        const nodes = section.nodes.filter((node) =>
          navNodeMatches(node, authorFilter),
        );
        return (
          <div key={section.id} className="mb-4 last:mb-0">
            <div className="px-2 pb-1 text-xs font-semibold uppercase tracking-wider text-fg-tertiary">
              {section.title}
            </div>
            {nodes.length === 0 ? (
              /*
               * Said rather than left blank. An empty Media section is a real
               * answer to "did this publish touch any images" — and a section
               * that vanished when empty would make its absence mean two things:
               * nothing changed, or this project has no galleries at all.
               */
              <div className="px-2 py-1 text-xs text-fg-tertiary">
                {authorFilter === null
                  ? "No changes"
                  : "Nothing by this person"}
              </div>
            ) : (
              <ul className="min-w-0">
                {nodes.map((node) => (
                  <NavRow
                    key={node.id}
                    node={node}
                    depth={0}
                    selectedId={selectedId}
                    onSelect={onSelect}
                    authorFilter={authorFilter}
                  />
                ))}
              </ul>
            )}
          </div>
        );
      })}
    </nav>
  );
}

function NavRow({
  node,
  depth,
  selectedId,
  onSelect,
  authorFilter,
}: {
  node: CompareNavNode;
  depth: number;
  selectedId: string | null;
  onSelect: (id: string) => void;
  authorFilter: string | null;
}) {
  const children = (node.children ?? []).filter((child) =>
    navNodeMatches(child, authorFilter),
  );
  const hasChildren = children.length > 0;
  /*
   * Open by default, at every depth.
   *
   * The tree only contains things that changed, so "collapsed" here hides the
   * very rows the dialog was opened to show. Collapsing exists for the case
   * where one directory has forty new images and is drowning the rest — which
   * is why the control is present at all, and why it is not the default.
   */
  const [open, setOpen] = useState(true);
  const Icon = KIND_ICONS[node.kind];
  const isSelected = node.id === selectedId;

  return (
    <li className="min-w-0">
      <div
        className={cn(
          "group flex min-w-0 items-center gap-1 rounded",
          isSelected ? "bg-bg-secondary" : "hover:bg-bg-secondary",
        )}
        style={{ paddingLeft: depth * 12 }}
      >
        {hasChildren ? (
          <button
            onClick={() => setOpen((prev) => !prev)}
            className="shrink-0 p-1 text-fg-tertiary"
            aria-label={
              open ? `Collapse ${node.label}` : `Expand ${node.label}`
            }
            aria-expanded={open}
          >
            {open ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
          </button>
        ) : (
          <span className="w-[20px] shrink-0" aria-hidden />
        )}
        <button
          onClick={() => onSelect(node.id)}
          aria-current={isSelected ? "true" : undefined}
          className="flex min-w-0 flex-1 items-center gap-2 py-1 pr-2 text-left"
        >
          <Icon
            size={13}
            className="shrink-0 text-fg-secondary-alt"
            aria-hidden
          />
          <span className="min-w-0 flex-1">
            <span
              className={cn(
                "block truncate text-sm",
                /*
                 * A removed page keeps its name readable rather than being
                 * struck through. The strike reads as "this row is disabled",
                 * and this row is the most important one in the list — it is
                 * the change you most want to click into before publishing.
                 */
                node.change === "removed"
                  ? "text-fg-secondary"
                  : "text-fg-primary",
              )}
            >
              {node.label}
            </span>
            {/*
             * A renamed row says what it used to be called, in place of its
             * sublabel.
             *
             * For a router record the key is the URL, so this line is a page
             * changing address — the change most likely to break an inbound
             * link, and the reason `moved` is worth a mark of its own rather
             * than being folded into "changed". The old name wins the slot
             * because the new one is already the label above it.
             */}
            {node.renamedFrom !== undefined ? (
              <span className="block truncate text-xs text-fg-tertiary">
                was <span className="font-mono">{node.renamedFrom}</span>
              </span>
            ) : (
              node.sublabel !== undefined && (
                <span className="block truncate text-xs text-fg-tertiary">
                  {node.sublabel}
                </span>
              )
            )}
          </span>
          {node.change !== undefined && (
            <span className="shrink-0" title={changeKindLabel(node.change)}>
              <ChangeKindIcon kind={node.change} />
            </span>
          )}
          {/*
           * The count sits on rows that have children, where it says how much
           * is hidden when collapsed. On a leaf it would only ever say "1",
           * next to an icon that already said which kind of 1 it is.
           *
           * Under a filter it counts the children that SURVIVED it. The stored
           * `changedCount` is the unfiltered total, and showing "3" above one
           * visible row reads as two rows having failed to render.
           */}
          {hasChildren && (
            <span className="shrink-0 text-xs tabular-nums text-fg-tertiary">
              {authorFilter === null
                ? (node.changedCount ?? children.length)
                : children.length}
            </span>
          )}
        </button>
      </div>
      {hasChildren && open && (
        <ul className="min-w-0">
          {children.map((child) => (
            <NavRow
              key={child.id}
              node={child}
              depth={depth + 1}
              selectedId={selectedId}
              onSelect={onSelect}
              authorFilter={authorFilter}
            />
          ))}
        </ul>
      )}
    </li>
  );
}
