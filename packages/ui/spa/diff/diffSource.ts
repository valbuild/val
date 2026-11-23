import {
  Internal,
  type ModuleFilePath,
  type SerializedObjectSchema,
  type SerializedSchema,
} from "@valbuild/core";
import { valueDiff } from "../compare/wordDiff";
import { sameJson } from "../proposals/siteDiff";
import { matchSequence, type SequenceMatch } from "./matchSequence";
import type {
  FieldDiff,
  ListItemDiff,
  MediaSide,
  RichTextBlockDiff,
  RichTextTag,
  ValueDiff,
} from "./types";

/**
 * What changed between two Sources of the same thing, as the smallest change
 * worth reading.
 *
 * From the SOURCE, not from patches. Review compares two states: what is
 * published against what is pending, or the site against a proposal. Half of
 * what a proposal changes is in no patch the Studio holds, so the one thing
 * both comparisons have is the two Sources, and that is what is diffed.
 *
 * Walked by the SCHEMA, so every row is a field an editor knows:
 *
 * - an object is the fields of it that changed, named by where they are;
 * - a string is a text, drawn word by word;
 * - an array is one list, its items matched to themselves (`matchSequence`),
 *   so an insertion is one line and a reorder says what moved;
 * - a record is one list by key, where a key that changed is a rename;
 * - a rich text is its blocks, matched the same way as an array's items;
 * - an image or a file is the file, and what was written about it.
 *
 * A value that does not fit its schema, or has none, is still walked, by its
 * own shape: Review must not leave a change out because it could not name it.
 *
 * Pure: no store, no React. What only the Studio knows is passed in
 * ({@link DiffOptions}).
 */
export type DiffInput = {
  moduleFilePath: ModuleFilePath;
  schema: SerializedSchema | undefined;
  before: unknown;
  after: unknown;
  /**
   * Where `before` and `after` are in the module, as patch path segments.
   * Empty for the module's root. A page of a router is `[route]`, with the
   * router's item schema.
   */
  path?: string[];
};

export type DiffOptions = {
  /**
   * What an array item or a record entry is CALLED: its preview, where the
   * schema declares one. Null leaves the engine to find a name in the value.
   */
  titleOf?: (sourcePath: string, value: unknown) => string | null;
  /**
   * Where a picture's bytes are served. The two sides can differ: a pending
   * upload is served by its patch. Defaults to the published address.
   */
  mediaUrl?: (path: string, side: "before" | "after") => string;
};

export function diffSource(
  input: DiffInput,
  options: DiffOptions = {},
): FieldDiff[] {
  const ctx: Ctx = { moduleFilePath: input.moduleFilePath, options };
  return fieldsOf(
    input.schema,
    input.before,
    input.after,
    { path: input.path ?? [], trail: [], gone: false },
    ctx,
  );
}

/**
 * What happened to each entry of a record, without drawing any of it.
 *
 * For a caller that files changes by entry: a page router's entries are
 * pages, and Review lists pages. The same matching the record's own list uses,
 * so a page that changed address is one renamed page in both places.
 */
export type RecordEntryChange = {
  /** The key now, or the key it had if it was removed. */
  key: string;
  change: "added" | "removed" | "changed" | "renamed" | "unchanged";
  /** The key it had before it was renamed. */
  renamedFrom?: string;
  before: unknown;
  after: unknown;
};

export function recordEntryChanges(
  before: unknown,
  after: unknown,
): RecordEntryChange[] {
  const was = isObject(before) ? before : {};
  const now = isObject(after) ? after : {};
  const gone = Object.keys(was).filter((key) => !hasOwn(now, key));
  const renamedFrom = new Map<string, string>();
  for (const key of Object.keys(now)) {
    if (hasOwn(was, key)) continue;
    // A key that is new, holding what a key that is gone held: a rename. The
    // most alike first, so two entries swapped and edited pair as themselves.
    let best: { from: string; score: number } | null = null;
    for (const from of gone) {
      if ([...renamedFrom.values()].includes(from)) continue;
      const score = sameJson(was[from], now[key])
        ? 1
        : similarity(was[from], now[key], undefined);
      if (score >= RENAMED && (best === null || score > best.score)) {
        best = { from, score };
      }
    }
    if (best !== null) renamedFrom.set(key, best.from);
  }
  const renamedAway = new Set(renamedFrom.values());
  const entries: RecordEntryChange[] = [];
  for (const key of Object.keys(now)) {
    const from = renamedFrom.get(key);
    if (from !== undefined) {
      entries.push({
        key,
        change: "renamed",
        renamedFrom: from,
        before: was[from],
        after: now[key],
      });
    } else if (!hasOwn(was, key)) {
      entries.push({ key, change: "added", before: null, after: now[key] });
    } else {
      entries.push({
        key,
        change: sameJson(was[key], now[key]) ? "unchanged" : "changed",
        before: was[key],
        after: now[key],
      });
    }
  }
  for (const key of gone) {
    if (renamedAway.has(key)) continue;
    entries.push({ key, change: "removed", before: was[key], after: null });
  }
  return entries;
}

/**
 * How alike two record entries must be to be one entry under a new key.
 *
 * Higher than an array item's bar: an array item that is half the same and in
 * the same list is very likely the same item, while two entries of a record
 * are often alike by design (two pages from one template).
 */
const RENAMED = 0.75;

/* --------------------------------------------------------------- the walk */

type Ctx = { moduleFilePath: ModuleFilePath; options: DiffOptions };

type At = {
  /** Patch path segments from the module's root. */
  path: string[];
  /** The segments a label is made of: from the pane's root, or an item's. */
  trail: string[];
  /**
   * The path is where the value WAS and is no longer: a removed item's
   * fields. It can collide with the path of what is there now, so the id
   * says which side it is on.
   */
  gone: boolean;
};

function child(at: At, segment: string): At {
  return { ...at, path: [...at.path, segment], trail: [...at.trail, segment] };
}

function sourcePathOf(at: At, ctx: Ctx): string {
  return Internal.joinModuleFilePathAndModulePath(
    ctx.moduleFilePath,
    Internal.patchPathToModulePath(at.path),
  );
}

function idOf(at: At, ctx: Ctx): string {
  return at.gone ? `${sourcePathOf(at, ctx)}@before` : sourcePathOf(at, ctx);
}

function field(at: At, ctx: Ctx, value: ValueDiff): FieldDiff {
  return { id: idOf(at, ctx), label: at.trail.join(" › "), value };
}

function fieldsOf(
  schema: SerializedSchema | undefined,
  beforeIn: unknown,
  afterIn: unknown,
  at: At,
  ctx: Ctx,
): FieldDiff[] {
  // Not there is not there, whether it is written `null` or left out.
  const before = beforeIn ?? null;
  const after = afterIn ?? null;
  if (sameJson(before, after)) return [];

  switch (schema?.type) {
    case "object":
      if (isObjectOrNull(before) && isObjectOrNull(after)) {
        return objectFields(schema.items, before, after, at, ctx);
      }
      break;
    case "discriminated-union":
      if (isObjectOrNull(before) && isObjectOrNull(after)) {
        return unionFields(schema.key, schema.items, before, after, at, ctx);
      }
      break;
    case "record":
      if (isObjectOrNull(before) && isObjectOrNull(after)) {
        return [
          field(at, ctx, recordValue(schema.item, before, after, at, ctx)),
        ];
      }
      break;
    case "array":
      if (isArrayOrNull(before) && isArrayOrNull(after)) {
        return [
          field(
            at,
            ctx,
            listValue(schema.item, before ?? [], after ?? [], at, ctx),
          ),
        ];
      }
      break;
    case "richtext": {
      const was = blocksOf(before);
      const now = blocksOf(after);
      if (was !== null && now !== null) {
        return [field(at, ctx, richTextValue(was, now, at, ctx))];
      }
      break;
    }
    case "image":
    case "file":
    case "video":
      if (isMediaOrNull(before) && isMediaOrNull(after)) {
        return mediaFields(schema.type === "image", before, after, at, ctx);
      }
      break;
    case "string":
    case "route":
    case "code":
      if (isStringOrNull(before) && isStringOrNull(after)) {
        return [field(at, ctx, { kind: "text", before, after })];
      }
      break;
    case "number":
    case "boolean":
    case "literal":
    case "enum":
    case "keyOf":
    case "date":
    case "dateTime":
    case "color":
    case "locale":
      // Read whole: half of `2026-11-17` struck out says less than both dates.
      if (isPrimitiveOrNull(before) && isPrimitiveOrNull(after)) {
        return [
          field(at, ctx, {
            kind: "scalar",
            before: spell(before),
            after: spell(after),
          }),
        ];
      }
      break;
    default:
      break;
  }
  return shapeFields(before, after, at, ctx);
}

/**
 * A value walked by its own shape: one with no schema, a schema with no
 * structure to walk (a number, a date, an enum), or one its schema does not
 * describe.
 */
function shapeFields(
  before: unknown,
  after: unknown,
  at: At,
  ctx: Ctx,
): FieldDiff[] {
  if (
    isObjectOrNull(before) &&
    isObjectOrNull(after) &&
    (before !== null || after !== null)
  ) {
    return objectFields({}, before, after, at, ctx);
  }
  if (
    isArrayOrNull(before) &&
    isArrayOrNull(after) &&
    (before !== null || after !== null)
  ) {
    return [
      field(at, ctx, listValue(undefined, before ?? [], after ?? [], at, ctx)),
    ];
  }
  if (isStringOrNull(before) && isStringOrNull(after)) {
    return [field(at, ctx, { kind: "text", before, after })];
  }
  return [
    field(at, ctx, {
      kind: "scalar",
      before: spell(before),
      after: spell(after),
    }),
  ];
}

/** A value read whole, as a reader is shown it. Null: it is not there. */
function spell(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  return clip(JSON.stringify(value), 120);
}

function objectFields(
  items: Record<string, SerializedSchema>,
  before: Record<string, unknown> | null,
  after: Record<string, unknown> | null,
  at: At,
  ctx: Ctx,
): FieldDiff[] {
  const out: FieldDiff[] = [];
  // The schema's fields in the schema's order, which is the editor's. Then
  // whatever else the two values hold: a field the schema no longer has is
  // still a change to what is stored.
  const keys = [
    ...Object.keys(items),
    ...unionKeys(before, after).filter((key) => !hasOwn(items, key)),
  ];
  for (const key of keys) {
    out.push(
      ...fieldsOf(items[key], before?.[key], after?.[key], child(at, key), ctx),
    );
  }
  return out;
}

function unionFields(
  key: string,
  variants: SerializedObjectSchema[],
  before: Record<string, unknown> | null,
  after: Record<string, unknown> | null,
  at: At,
  ctx: Ctx,
): FieldDiff[] {
  const variantOf = (
    value: Record<string, unknown> | null,
  ): SerializedObjectSchema | undefined =>
    variants.find((variant) => {
      const tag = variant.items[key];
      return tag?.type === "literal" && tag.value === value?.[key];
    });
  const was = variantOf(before);
  const now = variantOf(after);
  if (was === now) {
    return objectFields(now?.items ?? {}, before, after, at, ctx);
  }
  /*
   * It became another variant. A field both variants have, of the same kind,
   * is one field that changed; the rest went with the old variant or came
   * with the new one.
   */
  const out: FieldDiff[] = [];
  const keys = [
    ...Object.keys(now?.items ?? {}),
    ...Object.keys(was?.items ?? {}).filter(
      (each) => !hasOwn(now?.items ?? {}, each),
    ),
    ...unionKeys(before, after).filter(
      (each) =>
        !hasOwn(now?.items ?? {}, each) && !hasOwn(was?.items ?? {}, each),
    ),
  ];
  for (const each of keys) {
    const wasSchema = was?.items[each];
    const nowSchema = now?.items[each];
    const here = child(at, each);
    if (
      wasSchema !== undefined &&
      nowSchema !== undefined &&
      wasSchema.type !== nowSchema.type
    ) {
      out.push(
        ...fieldsOf(wasSchema, before?.[each], null, gone(here), ctx),
        ...fieldsOf(nowSchema, null, after?.[each], here, ctx),
      );
    } else {
      out.push(
        ...fieldsOf(
          nowSchema ?? wasSchema,
          before?.[each],
          after?.[each],
          here,
          ctx,
        ),
      );
    }
  }
  return out;
}

function gone(at: At): At {
  return { ...at, gone: true };
}

/* ------------------------------------------------------------------ lists */

function listValue(
  itemSchema: SerializedSchema | undefined,
  before: unknown[],
  after: unknown[],
  at: At,
  ctx: Ctx,
): ValueDiff {
  const unionKey =
    itemSchema?.type === "discriminated-union" ? itemSchema.key : undefined;
  const { matches } = matchSequence(before, after, {
    keyOf: canonical,
    similarity: (a, b) => similarity(a, b, unionKey),
    comparable: (a, b) => sameKind(a, b, unionKey),
  });
  const items = matches.map((match): ListItemDiff => {
    // An item's fields are named from the item, not from the page: the row
    // they sit under already says which item.
    const now: At =
      match.kind === "removed"
        ? { path: [...at.path, String(match.before)], trail: [], gone: true }
        : {
            path: [...at.path, String(match.after)],
            trail: [],
            gone: at.gone,
          };
    const id = `${idOf(at, ctx)}#${
      match.kind === "removed" ? `-${match.before}` : match.after
    }`;
    if (match.kind === "added") {
      const value = after[match.after];
      return {
        id,
        title: titleOf(itemSchema, value, now, ctx),
        at: match.after + 1,
        was: null,
        ...detailOf(fieldsOf(itemSchema, null, value, now, ctx)),
      };
    }
    if (match.kind === "removed") {
      const value = before[match.before];
      return {
        id,
        title: titleOf(itemSchema, value, now, ctx),
        at: null,
        was: match.before + 1,
        ...detailOf(fieldsOf(itemSchema, value, null, now, ctx)),
      };
    }
    const value = after[match.after];
    const fields = match.equal
      ? []
      : fieldsOf(itemSchema, before[match.before], value, now, ctx);
    return {
      id,
      title: titleOf(itemSchema, value, now, ctx),
      at: match.after + 1,
      was: match.before + 1,
      ...(match.moved ? { moved: true } : {}),
      ...(fields.length > 0 ? { fields } : {}),
    };
  });
  return { kind: "list", items };
}

/**
 * What an added or removed item held, behind "Show". Nothing for an item that
 * is its own title: a string in a list of strings has no more to show.
 */
function detailOf(fields: FieldDiff[]): { detail?: FieldDiff[] } {
  if (fields.length === 0) return {};
  if (fields.length === 1 && fields[0].label === "") {
    const only = fields[0].value;
    if (only.kind === "text" || only.kind === "scalar") return {};
  }
  return { detail: fields };
}

function recordValue(
  itemSchema: SerializedSchema,
  before: Record<string, unknown> | null,
  after: Record<string, unknown> | null,
  at: At,
  ctx: Ctx,
): ValueDiff {
  const wasKeys = Object.keys(before ?? {});
  const nowKeys = Object.keys(after ?? {});
  const items = recordEntryChanges(before, after).map((entry): ListItemDiff => {
    const removed = entry.change === "removed";
    const now: At = {
      path: [...at.path, entry.key],
      trail: [],
      gone: removed || at.gone,
    };
    const value = removed ? entry.before : entry.after;
    const fields = fieldsOf(itemSchema, entry.before, entry.after, now, ctx);
    const wasKey = entry.renamedFrom ?? entry.key;
    return {
      id: `${idOf(at, ctx)}#${removed ? "-" : ""}${entry.key}`,
      title: ctx.options.titleOf?.(sourcePathOf(now, ctx), value) ?? entry.key,
      key: entry.key,
      at: removed ? null : nowKeys.indexOf(entry.key) + 1,
      was: entry.change === "added" ? null : wasKeys.indexOf(wasKey) + 1,
      ...(entry.renamedFrom !== undefined
        ? { renamedFrom: entry.renamedFrom }
        : {}),
      ...(entry.change === "added" || removed
        ? detailOf(fields)
        : fields.length > 0
          ? { fields }
          : {}),
    };
  });
  return { kind: "list", items, keyed: true };
}

/** The names a field that titles its item usually has, most likely first. */
const TITLE_KEYS = ["title", "name", "heading", "headline", "label"];

/**
 * What an item is called: its preview where the caller has one, else the
 * first thing in it that reads as a name.
 */
function titleOf(
  schema: SerializedSchema | undefined,
  value: unknown,
  at: At,
  ctx: Ctx,
): string {
  const named = ctx.options.titleOf?.(sourcePathOf(at, ctx), value);
  if (named !== null && named !== undefined && named !== "") return named;
  if (typeof value === "string") {
    return value.trim() === "" ? "Empty" : clip(value, 80);
  }
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  if (isObject(value)) {
    if (typeof value.path === "string" && isMediaSchema(schema)) {
      return fileName(value.path);
    }
    const keys = [
      ...TITLE_KEYS,
      ...Object.keys(value).filter((key) => !TITLE_KEYS.includes(key)),
    ];
    const tagKey =
      schema?.type === "discriminated-union" ? schema.key : undefined;
    for (const key of keys) {
      const candidate = value[key];
      if (
        key !== tagKey &&
        typeof candidate === "string" &&
        candidate.trim() !== ""
      ) {
        return clip(candidate, 80);
      }
    }
    if (tagKey !== undefined && typeof value[tagKey] === "string") {
      return value[tagKey];
    }
  }
  return "Item";
}

function isMediaSchema(schema: SerializedSchema | undefined): boolean {
  return (
    schema?.type === "image" ||
    schema?.type === "file" ||
    schema?.type === "video"
  );
}

/* ------------------------------------------------------------- similarity */

/**
 * How much of two items is the same, from 0 to 1.
 *
 * For an object, the share of its fields that are equal, and only if at least
 * one of those says something: two items that agree on `published: false` and
 * nothing else are not the same item. A field edited a little counts as half.
 */
function similarity(
  a: unknown,
  b: unknown,
  unionKey: string | undefined,
): number {
  if (typeof a === "string" && typeof b === "string") {
    return textSimilarity(a, b);
  }
  if (!isObject(a) || !isObject(b)) return 0;
  if (unionKey !== undefined && a[unionKey] !== b[unionKey]) return 0;
  const keys = unionKeys(a, b).filter(
    (key) => key !== unionKey && key !== "patch_id",
  );
  if (keys.length === 0) return 0;
  let score = 0;
  let evidence = false;
  for (const key of keys) {
    const left = a[key] ?? null;
    const right = b[key] ?? null;
    if (sameJson(left, right)) {
      score += 1;
      if (saysSomething(left)) evidence = true;
    } else if (
      typeof left === "string" &&
      typeof right === "string" &&
      textSimilarity(left, right) >= 0.6
    ) {
      score += 0.5;
      evidence = true;
    }
  }
  return evidence ? score / keys.length : 0;
}

/** A value that could tell one item from another: not empty, not a flag. */
function saysSomething(value: unknown): boolean {
  if (typeof value === "string") return value.trim() !== "";
  if (typeof value === "number") return true;
  if (Array.isArray(value)) return value.length > 0;
  return isObject(value) && Object.keys(value).length > 0;
}

/** The share of the longer text that the two have in common. */
function textSimilarity(a: string, b: string): number {
  if (a === b) return 1;
  const longest = Math.max(a.length, b.length);
  if (longest === 0) return 0;
  let same = 0;
  for (const segment of valueDiff(a, b)) {
    if (segment.kind === "same") same += segment.text.trim().length;
  }
  return same / longest;
}

/** Whether one could have been rewritten into the other: the same kind. */
function sameKind(
  a: unknown,
  b: unknown,
  unionKey: string | undefined,
): boolean {
  if (a === null || b === null) return false;
  if (Array.isArray(a) || Array.isArray(b)) {
    return Array.isArray(a) && Array.isArray(b);
  }
  if (isObject(a) && isObject(b)) {
    return unionKey === undefined || a[unionKey] === b[unionKey];
  }
  return typeof a === typeof b && typeof a !== "object";
}

/* -------------------------------------------------------------- rich text */

type Block = {
  tag: RichTextTag;
  /** Its words, with no formatting. */
  text: string;
  /** Everything about it, formatting and links included. */
  key: string;
};

const BLOCK_TAGS: Record<string, RichTextTag> = {
  p: "p",
  h1: "h1",
  h2: "h2",
  h3: "h3",
  h4: "h4",
  h5: "h5",
  h6: "h6",
};

/**
 * A rich text value as the blocks a reader sees: paragraphs, headings and
 * list items, in order. Null when the value is not a rich text's.
 */
function blocksOf(value: unknown): Block[] | null {
  if (value === null) return [];
  if (!Array.isArray(value)) return null;
  const out: Block[] = [];
  const list = (node: Record<string, unknown>): void => {
    for (const item of childrenOf(node)) {
      if (!isObject(item)) continue;
      for (const inner of childrenOf(item)) {
        if (!isObject(inner)) continue;
        if (inner.tag === "ul" || inner.tag === "ol") {
          list(inner);
        } else {
          out.push({
            tag: "li",
            text: inlineText(childrenOf(inner)),
            key: `${String(node.tag)}:${canonical(inner)}`,
          });
        }
      }
    }
  };
  for (const node of value) {
    if (!isObject(node) || typeof node.tag !== "string") return null;
    if (node.tag === "ul" || node.tag === "ol") {
      list(node);
    } else {
      out.push({
        tag: BLOCK_TAGS[node.tag] ?? "p",
        text: inlineText(childrenOf(node)),
        key: canonical(node),
      });
    }
  }
  return out;
}

function childrenOf(node: Record<string, unknown>): unknown[] {
  return Array.isArray(node.children) ? node.children : [];
}

function inlineText(children: unknown[]): string {
  let text = "";
  for (const node of children) {
    if (typeof node === "string") {
      text += node;
    } else if (isObject(node)) {
      if (node.tag === "br") text += "\n";
      else if (node.tag === "img") {
        text +=
          isObject(node.src) && typeof node.src.path === "string"
            ? `[image ${fileName(node.src.path)}]`
            : "[image]";
      } else text += inlineText(childrenOf(node));
    }
  }
  return text;
}

/** Headings are a kind, whatever their level; so are paragraphs, and items. */
function blockKind(tag: RichTextTag): "heading" | "paragraph" | "item" {
  return tag === "p" ? "paragraph" : tag === "li" ? "item" : "heading";
}

function richTextValue(
  before: Block[],
  after: Block[],
  at: At,
  ctx: Ctx,
): ValueDiff {
  const { matches } = matchSequence(before, after, {
    keyOf: (block) => block.key,
    similarity: (a, b) =>
      blockKind(a.tag) === blockKind(b.tag)
        ? textSimilarity(a.text, b.text)
        : 0,
    comparable: (a, b) => blockKind(a.tag) === blockKind(b.tag),
  });
  const blocks: RichTextBlockDiff[] = [];
  let unchanged = 0;
  const flush = (): void => {
    if (unchanged > 0) blocks.push({ kind: "unchanged", count: unchanged });
    unchanged = 0;
  };
  const id = (match: SequenceMatch): string =>
    `${idOf(at, ctx)}#block:${
      match.kind === "removed" ? `-${match.before}` : match.after
    }`;
  for (const match of matches) {
    if (match.kind === "kept" && match.equal && !match.moved) {
      unchanged += 1;
      continue;
    }
    flush();
    if (match.kind === "added") {
      const block = after[match.after];
      blocks.push({
        kind: "block",
        id: id(match),
        tag: block.tag,
        change: "added",
        after: block.text,
      });
    } else if (match.kind === "removed") {
      const block = before[match.before];
      blocks.push({
        kind: "block",
        id: id(match),
        tag: block.tag,
        change: "removed",
        before: block.text,
      });
    } else {
      const was = before[match.before];
      const now = after[match.after];
      const movedBy = match.moved ? match.after - match.before : 0;
      blocks.push({
        kind: "block",
        id: id(match),
        tag: now.tag,
        change: match.equal ? "moved" : "changed",
        ...(match.equal ? {} : { before: was.text }),
        after: now.text,
        ...(movedBy !== 0 ? { movedBy } : {}),
        // The words are the same, so the text alone would show no change.
        ...(!match.equal && was.text === now.text
          ? {
              note:
                was.tag === now.tag
                  ? "Formatting changed"
                  : "Heading level changed",
            }
          : {}),
      });
    }
  }
  flush();
  return { kind: "richtext", blocks };
}

/* ------------------------------------------------------------------ media */

/** What the bytes say about themselves: replaced with the file, not edited. */
const DERIVED_KEYS = ["width", "height", "mimeType", "duration"];

function mediaFields(
  image: boolean,
  before: Record<string, unknown> | null,
  after: Record<string, unknown> | null,
  at: At,
  ctx: Ctx,
): FieldDiff[] {
  const out: FieldDiff[] = [];
  const replaced = before?.path !== after?.path;
  if (replaced) {
    out.push(
      field(at, ctx, {
        kind: "media",
        before: mediaSide(image, before, "before", ctx),
        after: mediaSide(image, after, "after", ctx),
      }),
    );
  }
  // Gone, and what was written about it went along: that is one removal.
  if (after === null) return out;
  for (const key of unionKeys(before, after)) {
    if (key === "path" || key === "patch_id") continue;
    // A new file has new dimensions. That is the same change, said already.
    if (replaced && DERIVED_KEYS.includes(key)) continue;
    const here = child(at, key);
    const was = before?.[key] ?? null;
    const now = after?.[key] ?? null;
    if (sameJson(was, now)) continue;
    if (key === "hotspot") {
      out.push(
        field(here, ctx, {
          kind: "scalar",
          before: spellHotspot(was),
          after: spellHotspot(now),
        }),
      );
    } else {
      out.push(...shapeFields(was, now, here, ctx));
    }
  }
  return out;
}

function mediaSide(
  image: boolean,
  value: Record<string, unknown> | null,
  side: "before" | "after",
  ctx: Ctx,
): MediaSide | null {
  if (value === null || typeof value.path !== "string") return null;
  const { width, height, mimeType } = value;
  const note =
    typeof width === "number" && typeof height === "number"
      ? `${width} × ${height}`
      : typeof mimeType === "string"
        ? mimeType
        : undefined;
  return {
    url: image
      ? (ctx.options.mediaUrl?.(value.path, side) ??
        Internal.mediaUrl({ path: value.path }))
      : null,
    name: fileName(value.path),
    ...(note !== undefined ? { note } : {}),
  };
}

/** `50% 30%`: where the focal point is, from the left and from the top. */
function spellHotspot(value: unknown): string | null {
  if (!isObject(value)) return spell(value);
  const { x, y } = value;
  if (typeof x !== "number" || typeof y !== "number") return spell(value);
  return `${Math.round(x * 100)}% ${Math.round(y * 100)}%`;
}

function fileName(path: string): string {
  const clean = path.split(/[?#]/)[0];
  return clean.slice(clean.lastIndexOf("/") + 1) || path;
}

/* ---------------------------------------------------------------- helpers */

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isObjectOrNull(
  value: unknown,
): value is Record<string, unknown> | null {
  return value === null || isObject(value);
}

function isArrayOrNull(value: unknown): value is unknown[] | null {
  return value === null || Array.isArray(value);
}

function isPrimitiveOrNull(
  value: unknown,
): value is string | number | boolean | null {
  return value === null || typeof value !== "object";
}

function isStringOrNull(value: unknown): value is string | null {
  return value === null || typeof value === "string";
}

function isMediaOrNull(
  value: unknown,
): value is Record<string, unknown> | null {
  return value === null || (isObject(value) && typeof value.path === "string");
}

function hasOwn(object: object, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(object, key);
}

function unionKeys(
  a: Record<string, unknown> | null,
  b: Record<string, unknown> | null,
): string[] {
  return [...new Set([...Object.keys(a ?? {}), ...Object.keys(b ?? {})])];
}

function clip(text: string, length: number): string {
  const line = text.replace(/\s+/g, " ").trim();
  return line.length > length ? `${line.slice(0, length - 1)}…` : line;
}

/**
 * A value as one string, the same for two values that are the same JSON
 * whatever order their keys were written in.
 */
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (isObject(value)) {
    return `{${Object.keys(value)
      .filter((key) => value[key] !== undefined)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value ?? null);
}
