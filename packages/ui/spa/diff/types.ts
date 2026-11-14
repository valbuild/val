/**
 * What changed inside one value, as the smallest thing worth reading.
 *
 * The compare view used to draw a changed field as the whole field twice, and
 * left the reader to find the difference by eye. This is the shape a renderer
 * needs to draw only the difference: the words that changed in a text, the
 * paragraphs that changed in a rich text, the items that were added, removed,
 * edited or moved in a list.
 *
 * Written by hand in the stories for now. The function that produces it from
 * a schema and two Sources is the next step, and these types are its return
 * type, so the stories are the layout that function has to feed.
 */

/** One column with the change marked in place, or the two sides in columns. */
export type DiffLayout = "inline" | "split";

/** A picture or a file, on one side. */
export type MediaSide = {
  url: string;
  /** The file's name. */
  name: string;
  /** Its size, or anything else that tells two files apart: `1200×600`. */
  note?: string;
};

export type ValueDiff =
  /** A string. `null` is a side where the value was not there. */
  | { kind: "text"; before: string | null; after: string | null }
  /**
   * A value read whole rather than word by word: a number, a boolean, a date,
   * an enum, a reference. Already spelled for a reader.
   */
  | { kind: "scalar"; before: string | null; after: string | null }
  | { kind: "media"; before: MediaSide | null; after: MediaSide | null }
  | { kind: "richtext"; blocks: RichTextBlockDiff[] }
  | { kind: "list"; items: ListItemDiff[] }
  /** An object: only the fields that changed. */
  | { kind: "fields"; fields: FieldDiff[] };

/** One changed field, named by where it sits in what the pane is of. */
export type FieldDiff = {
  id: string;
  /** `hero › image`. */
  label: string;
  value: ValueDiff;
};

/**
 * One item of an array, matched to itself across the two sides.
 *
 * An item is listed ONCE, where it is now. `moved` is set only for the
 * smallest set of items that changed place relative to the others: an item
 * whose index shifted because another was inserted above it did not move.
 */
export type ListItemDiff = {
  id: string;
  /** What the item is called: its preview, or a fallback. */
  title: string;
  /** Its place now, counted from 1. Null: it was removed. */
  at: number | null;
  /** Its place before, counted from 1. Null: it was added. */
  was: number | null;
  moved?: boolean;
  /** The fields edited inside it. */
  fields?: FieldDiff[];
  /** The whole item, for one that was added or removed, behind "Show". */
  detail?: FieldDiff[];
};

export type ListItemChange =
  | "added"
  | "removed"
  | "changed"
  | "moved"
  | "moved-changed"
  | "unchanged";

export function listItemChange(item: ListItemDiff): ListItemChange {
  if (item.at === null) return "removed";
  if (item.was === null) return "added";
  const edited = item.fields !== undefined && item.fields.length > 0;
  if (item.moved) return edited ? "moved-changed" : "moved";
  return edited ? "changed" : "unchanged";
}

export type RichTextTag = "p" | "h1" | "h2" | "h3" | "li" | "quote";

/** One block of a rich text value, or a run of blocks nothing happened to. */
export type RichTextBlockDiff =
  | { kind: "unchanged"; count: number }
  | {
      kind: "block";
      id: string;
      tag: RichTextTag;
      change: "added" | "removed" | "changed" | "moved";
      /** Its text before. Absent for an added block. */
      before?: string;
      /** Its text now. Absent for a removed block. */
      after?: string;
      /** How many blocks it moved: negative is up. */
      movedBy?: number;
    };
