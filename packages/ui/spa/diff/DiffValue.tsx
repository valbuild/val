import { useState, type ReactNode } from "react";
import {
  ArrowDown,
  ArrowRight,
  ArrowUp,
  ChevronDown,
  ChevronRight,
  Minus,
  Pencil,
  Plus,
} from "lucide-react";
import { cn } from "../components/designSystem/cn";
import { segmentClass, sideRailClass } from "../compare/ChangeKindIcon";
import {
  isWorthDiffing,
  valueDiff,
  type DiffSegment,
} from "../compare/wordDiff";
import {
  listItemChange,
  type DiffLayout,
  type FieldDiff,
  type ListItemChange,
  type ListItemDiff,
  type MediaSide,
  type RichTextBlockDiff,
  type RichTextTag,
  type ValueDiff,
} from "./types";

/**
 * Changed fields, each drawn as the smallest change worth reading.
 *
 * Two layouts of one model. `inline` marks the change in place, in one
 * column: what was removed is struck through and what was added is tinted.
 * `split` puts the two sides in columns. Only a LEAF is ever split: a list or
 * a rich text is one outline in both layouts, because an item that moved has
 * one place to be shown, and two columns would have to show it twice.
 */
export function DiffFields({
  fields,
  layout,
  renderMeta,
  nested = false,
}: {
  fields: FieldDiff[];
  layout: DiffLayout;
  /** What sits at the end of a field's heading: who changed it, its history. */
  renderMeta?: (field: FieldDiff) => ReactNode;
  /** Inside a list item or an object, where the headings are quieter. */
  nested?: boolean;
}) {
  return (
    <div className={cn("flex min-w-0 flex-col", nested ? "gap-3" : "gap-5")}>
      {fields.map((field) => (
        <section
          key={field.id}
          className="group/field min-w-0"
          data-field-id={field.id}
        >
          <div className="mb-1 flex min-h-6 min-w-0 items-center gap-2">
            <h3
              className={cn(
                "min-w-0 truncate text-xs",
                nested
                  ? "text-fg-tertiary"
                  : "font-semibold uppercase tracking-wider text-fg-secondary",
              )}
            >
              {field.label}
            </h3>
            {field.value.kind === "list" && (
              <span className="truncate text-xs text-fg-tertiary">
                {listSummary(field.value.items)}
              </span>
            )}
            {field.value.kind === "richtext" && (
              <span className="truncate text-xs text-fg-tertiary">
                {richTextSummary(field.value.blocks)}
              </span>
            )}
            {renderMeta !== undefined && (
              <span className="ml-auto flex shrink-0 items-center gap-2">
                {renderMeta(field)}
              </span>
            )}
          </div>
          <DiffValueView value={field.value} layout={layout} />
        </section>
      ))}
    </div>
  );
}

export function DiffValueView({
  value,
  layout,
}: {
  value: ValueDiff;
  layout: DiffLayout;
}) {
  switch (value.kind) {
    case "text":
      return (
        <TextDiff before={value.before} after={value.after} layout={layout} />
      );
    case "scalar":
      return (
        <ScalarDiff before={value.before} after={value.after} layout={layout} />
      );
    case "media":
      return (
        <MediaDiff before={value.before} after={value.after} layout={layout} />
      );
    case "richtext":
      return <RichTextDiff blocks={value.blocks} layout={layout} />;
    case "list":
      return <ListDiff items={value.items} layout={layout} />;
    case "fields":
      return (
        <div className="border-l border-border-secondary pl-3">
          <DiffFields fields={value.fields} layout={layout} nested />
        </div>
      );
  }
}

/* ---------------------------------------------------------------- leaves */

/** The two sides of a leaf, in columns, each with its rail. */
function Split({ before, after }: { before: ReactNode; after: ReactNode }) {
  return (
    <div className="grid min-w-0 grid-cols-2 gap-4">
      <div className={cn("min-w-0 py-0.5 pl-2", sideRailClass("before"))}>
        {before}
      </div>
      <div className={cn("min-w-0 py-0.5 pl-2", sideRailClass("after"))}>
        {after}
      </div>
    </div>
  );
}

/** A side with no value: said, because a blank reads as an empty string. */
function Absent({ children }: { children: string }) {
  return <span className="text-sm italic text-fg-tertiary">{children}</span>;
}

function Segments({
  segments,
  drop,
}: {
  segments: DiffSegment[];
  /** The side whose own segments are left out, in a column. */
  drop?: "added" | "removed";
}) {
  return (
    <span className="whitespace-pre-wrap break-words">
      {segments
        .filter((segment) => segment.kind !== drop)
        .map((segment, index, shown) => (
          <span
            key={index}
            className={cn(
              "rounded-sm",
              segmentClass(segment.kind),
              /*
               * A replacement is a removal with its addition right after it,
               * and nothing between them: "yourthe". A hair of space keeps
               * them two words without adding a character to either.
               */
              segment.kind === "added" &&
                shown[index - 1]?.kind === "removed" &&
                "ml-1",
            )}
          >
            {segment.text}
          </span>
        ))}
    </span>
  );
}

/**
 * The segments to draw for two strings.
 *
 * Two values with too little in common are not diffed word by word: every
 * other word struck through is harder to read than the old value and then the
 * new one. They come back as one removed and one added segment.
 */
function segmentsOf(before: string, after: string): DiffSegment[] {
  const segments = valueDiff(before, after);
  if (isWorthDiffing(segments)) return segments;
  return [
    { text: before, kind: "removed" },
    { text: after, kind: "added" },
  ];
}

function TextDiff({
  before,
  after,
  layout,
  className = "text-sm text-fg-primary",
}: {
  before: string | null;
  after: string | null;
  layout: DiffLayout;
  className?: string;
}) {
  const segments: DiffSegment[] =
    before === null
      ? [{ text: after ?? "", kind: "added" }]
      : after === null
        ? [{ text: before, kind: "removed" }]
        : segmentsOf(before, after);
  if (layout === "split") {
    return (
      <div className={className}>
        <Split
          before={
            before === null ? (
              <Absent>Did not exist</Absent>
            ) : (
              <Segments segments={segments} drop="added" />
            )
          }
          after={
            after === null ? (
              <Absent>Removed</Absent>
            ) : (
              <Segments segments={segments} drop="removed" />
            )
          }
        />
      </div>
    );
  }
  /*
   * Rewritten whole: the old value on its own line and the new one under it.
   * Run together they would read as one sentence with a struck-out first half.
   */
  const rewritten =
    segments.length === 2 &&
    segments[0].kind === "removed" &&
    segments[1].kind === "added";
  return (
    <div className={cn("min-w-0", className)}>
      {rewritten ? (
        <div className="flex min-w-0 flex-col gap-1">
          <Segments segments={[segments[0]]} />
          <Segments segments={[segments[1]]} />
        </div>
      ) : (
        <Segments segments={segments} />
      )}
    </div>
  );
}

function ScalarToken({
  value,
  kind,
}: {
  value: string;
  kind: "removed" | "added";
}) {
  return (
    <span
      className={cn(
        "rounded-sm px-1 font-mono text-[13px]",
        segmentClass(kind),
      )}
    >
      {value}
    </span>
  );
}

function ScalarDiff({
  before,
  after,
  layout,
}: {
  before: string | null;
  after: string | null;
  layout: DiffLayout;
}) {
  const left =
    before === null ? (
      <Absent>Did not exist</Absent>
    ) : (
      <ScalarToken value={before} kind="removed" />
    );
  const right =
    after === null ? (
      <Absent>Removed</Absent>
    ) : (
      <ScalarToken value={after} kind="added" />
    );
  if (layout === "split") return <Split before={left} after={right} />;
  return (
    <div className="flex min-w-0 flex-wrap items-center gap-2 text-sm">
      {left}
      <ArrowRight size={14} className="shrink-0 text-fg-tertiary" aria-hidden />
      <span className="sr-only">became</span>
      {right}
    </div>
  );
}

function MediaThumb({
  media,
  kind,
}: {
  media: MediaSide;
  kind: "removed" | "added";
}) {
  return (
    <figure className="flex min-w-0 items-center gap-2">
      <img
        src={media.url}
        alt=""
        className={cn(
          "h-14 w-20 shrink-0 rounded border object-cover",
          kind === "removed"
            ? "border-rose-500/50 opacity-70"
            : "border-sky-500/50",
        )}
      />
      <figcaption className="min-w-0 text-xs">
        <div
          className={cn(
            "truncate text-fg-primary",
            kind === "removed" && "line-through decoration-rose-500/60",
          )}
        >
          {media.name}
        </div>
        {media.note !== undefined && (
          <div className="truncate text-fg-tertiary">{media.note}</div>
        )}
      </figcaption>
    </figure>
  );
}

function MediaDiff({
  before,
  after,
  layout,
}: {
  before: MediaSide | null;
  after: MediaSide | null;
  layout: DiffLayout;
}) {
  const left =
    before === null ? (
      <Absent>Did not exist</Absent>
    ) : (
      <MediaThumb media={before} kind="removed" />
    );
  const right =
    after === null ? (
      <Absent>Removed</Absent>
    ) : (
      <MediaThumb media={after} kind="added" />
    );
  if (layout === "split") return <Split before={left} after={right} />;
  return (
    <div className="flex min-w-0 flex-wrap items-center gap-3">
      {left}
      <ArrowRight size={14} className="shrink-0 text-fg-tertiary" aria-hidden />
      <span className="sr-only">became</span>
      {right}
    </div>
  );
}

/* ------------------------------------------------------------------ list */

/**
 * The mark for something that moved. A colour of its own, from the same fixed
 * palette as added and removed: a move is neither, and has to be told from
 * both at a glance.
 */
const MOVED_CLASS = "text-violet-600 dark:text-violet-400";

function plural(count: number, one: string, many = `${one}s`): string {
  return `${count} ${count === 1 ? one : many}`;
}

/** `1 moved · 1 added · 1 changed · 3 unchanged`: whether to read on at all. */
export function listSummary(items: ListItemDiff[]): string {
  const counts: Record<ListItemChange, number> = {
    added: 0,
    removed: 0,
    changed: 0,
    moved: 0,
    "moved-changed": 0,
    unchanged: 0,
  };
  for (const item of items) counts[listItemChange(item)] += 1;
  const parts: string[] = [];
  const moved = counts.moved + counts["moved-changed"];
  const changed = counts.changed + counts["moved-changed"];
  if (moved > 0) parts.push(`${moved} moved`);
  if (counts.added > 0) parts.push(`${counts.added} added`);
  if (counts.removed > 0) parts.push(`${counts.removed} removed`);
  if (changed > 0) parts.push(`${changed} changed`);
  if (counts.unchanged > 0) parts.push(`${counts.unchanged} unchanged`);
  return parts.join(" · ");
}

function listItemStatus(item: ListItemDiff, change: ListItemChange): string {
  switch (change) {
    case "added":
      return "Added";
    case "removed":
      return `Removed, was ${item.was}`;
    case "changed":
      return "Changed";
    case "moved":
      return `Moved from ${item.was}`;
    case "moved-changed":
      return `Moved from ${item.was}, changed`;
    case "unchanged":
      return "";
  }
}

function ListMark({ item }: { item: ListItemDiff }) {
  const change = listItemChange(item);
  const size = 14;
  if (change === "added") {
    return (
      <Plus
        size={size}
        className="text-sky-600 dark:text-sky-400"
        aria-hidden
      />
    );
  }
  if (change === "removed") {
    return (
      <Minus
        size={size}
        className="text-rose-600 dark:text-rose-400"
        aria-hidden
      />
    );
  }
  if (change === "changed") {
    return <Pencil size={size - 2} className="text-fg-tertiary" aria-hidden />;
  }
  if (change === "moved" || change === "moved-changed") {
    const up = (item.at ?? 0) < (item.was ?? 0);
    const Arrow = up ? ArrowUp : ArrowDown;
    return <Arrow size={size} className={MOVED_CLASS} aria-hidden />;
  }
  return <span style={{ width: size, height: size }} aria-hidden />;
}

type ListRun =
  | { kind: "item"; item: ListItemDiff }
  | { kind: "unchanged"; id: string; items: ListItemDiff[] };

/**
 * Runs of two or more unchanged items fold to one line. One on its own stays:
 * it is the context that says where the changes around it are.
 */
function runsOf(items: ListItemDiff[]): ListRun[] {
  const runs: ListRun[] = [];
  let pending: ListItemDiff[] = [];
  const flush = (): void => {
    if (pending.length >= 2) {
      runs.push({ kind: "unchanged", id: pending[0].id, items: pending });
    } else {
      for (const item of pending) runs.push({ kind: "item", item });
    }
    pending = [];
  };
  for (const item of items) {
    if (listItemChange(item) === "unchanged") {
      pending.push(item);
    } else {
      flush();
      runs.push({ kind: "item", item });
    }
  }
  flush();
  return runs;
}

function ListDiff({
  items,
  layout,
}: {
  items: ListItemDiff[];
  layout: DiffLayout;
}) {
  const [shown, setShown] = useState<ReadonlySet<string>>(new Set());
  return (
    <ol className="min-w-0 rounded-md border border-border-secondary">
      {runsOf(items).map((run) =>
        run.kind === "item" ? (
          <ListItemRow key={run.item.id} item={run.item} layout={layout} />
        ) : shown.has(run.id) ? (
          run.items.map((item) => (
            <ListItemRow key={item.id} item={item} layout={layout} />
          ))
        ) : (
          <li
            key={run.id}
            className="border-b border-border-secondary last:border-b-0"
          >
            <button
              type="button"
              onClick={() => setShown(new Set([...shown, run.id]))}
              className="flex w-full items-center gap-2 px-3 py-1 text-left text-xs text-fg-tertiary hover:bg-bg-secondary hover:text-fg-secondary"
            >
              <span className="w-6 text-right" aria-hidden>
                ⋯
              </span>
              {run.items.length} unchanged
            </button>
          </li>
        ),
      )}
    </ol>
  );
}

function ListItemRow({
  item,
  layout,
}: {
  item: ListItemDiff;
  layout: DiffLayout;
}) {
  const change = listItemChange(item);
  const inside = item.fields ?? item.detail;
  /*
   * An edited item is open: its fields ARE the change. An added or removed
   * one is one line, and opens on request, because the statement is that it
   * came or went and its contents are a detail of that.
   */
  const [open, setOpen] = useState(item.fields !== undefined);
  const expandable = inside !== undefined && inside.length > 0;
  const status = listItemStatus(item, change);
  const head = (
    <>
      <span className="w-6 shrink-0 text-right font-mono text-xs text-fg-tertiary">
        {item.at ?? ""}
      </span>
      <span className="flex w-4 shrink-0 justify-center">
        <ListMark item={item} />
      </span>
      <span
        className={cn(
          "min-w-0 truncate text-sm",
          change === "unchanged" ? "text-fg-tertiary" : "text-fg-primary",
          change === "removed" && "line-through decoration-rose-500/60",
        )}
      >
        {item.title}
      </span>
      {status !== "" && (
        <span className="ml-auto shrink-0 pl-3 text-xs text-fg-secondary">
          {status}
        </span>
      )}
      {expandable &&
        (open ? (
          <ChevronDown size={14} className="shrink-0 text-fg-tertiary" />
        ) : (
          <ChevronRight size={14} className="shrink-0 text-fg-tertiary" />
        ))}
    </>
  );
  return (
    <li
      className={cn(
        "min-w-0 border-b border-border-secondary last:border-b-0",
        change === "added" && "bg-sky-500/5",
        change === "removed" && "bg-rose-500/5",
      )}
    >
      {expandable ? (
        <button
          type="button"
          aria-expanded={open}
          onClick={() => setOpen(!open)}
          className="flex w-full min-w-0 items-center gap-2 px-3 py-1.5 text-left hover:bg-bg-secondary"
        >
          {head}
        </button>
      ) : (
        <div className="flex min-w-0 items-center gap-2 px-3 py-1.5">
          {head}
        </div>
      )}
      {expandable && open && (
        <div className="pb-3 pl-[3.25rem] pr-3 pt-1">
          <DiffFields fields={inside} layout={layout} nested />
        </div>
      )}
    </li>
  );
}

/* ------------------------------------------------------------- rich text */

export function richTextSummary(blocks: RichTextBlockDiff[]): string {
  const counts = { changed: 0, moved: 0, added: 0, removed: 0 };
  for (const block of blocks) {
    if (block.kind === "block") counts[block.change] += 1;
  }
  const parts: string[] = [];
  if (counts.changed > 0) parts.push(`${counts.changed} changed`);
  if (counts.moved > 0) parts.push(`${counts.moved} moved`);
  if (counts.added > 0) parts.push(`${counts.added} added`);
  if (counts.removed > 0) parts.push(`${counts.removed} removed`);
  return parts.join(" · ");
}

const TAG_CLASS: Record<RichTextTag, string> = {
  p: "text-sm text-fg-primary",
  h1: "text-lg font-semibold text-fg-primary",
  h2: "text-base font-semibold text-fg-primary",
  h3: "text-sm font-semibold text-fg-primary",
  li: "text-sm text-fg-primary",
  quote: "border-l-2 border-border-primary pl-3 text-sm italic text-fg-primary",
};

const TAG_NAME: Record<RichTextTag, string> = {
  p: "paragraph",
  h1: "heading",
  h2: "heading",
  h3: "heading",
  li: "list item",
  quote: "quote",
};

/** `Quote moved up 2 blocks`: what moved, and how far. */
function movedWords(movedBy: number, tag: RichTextTag): string {
  const distance = Math.abs(movedBy);
  const name = TAG_NAME[tag];
  return `${name.charAt(0).toUpperCase()}${name.slice(1)} moved ${
    movedBy < 0 ? "up" : "down"
  } ${plural(distance, "block")}`;
}

function RichTextDiff({
  blocks,
  layout,
}: {
  blocks: RichTextBlockDiff[];
  layout: DiffLayout;
}) {
  return (
    <div className="flex min-w-0 flex-col gap-2 rounded-md border border-border-secondary px-3 py-2">
      {blocks.map((block, index) => {
        if (block.kind === "unchanged") {
          return (
            <div key={index} className="text-xs text-fg-tertiary">
              ⋯ {plural(block.count, "unchanged block")}
            </div>
          );
        }
        const moved = block.change === "moved";
        return (
          <div key={block.id} className="flex min-w-0 items-start gap-2">
            <span className="mt-1 flex w-4 shrink-0 justify-center">
              {block.change === "added" && (
                <Plus
                  size={14}
                  className="text-sky-600 dark:text-sky-400"
                  aria-label="Added"
                />
              )}
              {block.change === "removed" && (
                <Minus
                  size={14}
                  className="text-rose-600 dark:text-rose-400"
                  aria-label="Removed"
                />
              )}
              {block.change === "changed" && (
                <Pencil
                  size={12}
                  className="text-fg-tertiary"
                  aria-label="Changed"
                />
              )}
              {moved &&
                ((block.movedBy ?? 0) < 0 ? (
                  <ArrowUp size={14} className={MOVED_CLASS} aria-hidden />
                ) : (
                  <ArrowDown size={14} className={MOVED_CLASS} aria-hidden />
                ))}
            </span>
            <div className="min-w-0 flex-1">
              {block.tag === "li" && layout === "inline" ? (
                <div className="flex min-w-0 gap-2">
                  <span className="text-fg-tertiary" aria-hidden>
                    •
                  </span>
                  <BlockText block={block} layout={layout} />
                </div>
              ) : (
                <BlockText block={block} layout={layout} />
              )}
              {moved && block.movedBy !== undefined && (
                <div className="pt-0.5 text-xs text-fg-secondary">
                  {movedWords(block.movedBy, block.tag)}
                </div>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function BlockText({
  block,
  layout,
}: {
  block: Extract<RichTextBlockDiff, { kind: "block" }>;
  layout: DiffLayout;
}) {
  /*
   * A moved block is the same text in a new place. It is drawn once and
   * plain: marking it added or removed would claim an edit that did not
   * happen.
   */
  if (block.change === "moved") {
    return (
      <div className={cn("min-w-0", TAG_CLASS[block.tag])}>
        {block.after ?? block.before ?? ""}
      </div>
    );
  }
  return (
    <TextDiff
      before={block.change === "added" ? null : (block.before ?? "")}
      after={block.change === "removed" ? null : (block.after ?? "")}
      /*
       * An added or removed block is one statement in either layout; two
       * columns would spend one of them on "Did not exist".
       */
      layout={block.change === "changed" ? layout : "inline"}
      className={cn("min-w-0 flex-1", TAG_CLASS[block.tag])}
    />
  );
}
