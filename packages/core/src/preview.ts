import { Schema } from "./schema";
import { SelectorSource } from "./selector";
import { ImageSource } from "./source/media";
import { splitModuleFilePathAndModulePath, splitModulePath } from "./module";
import { ModuleFilePath, SourcePath } from "./val";

/**
 * THE RULE, and the only sentence that needs to be remembered:
 *
 *   **`.describe()` is INPUT HELP and is shown wherever that field — or a
 *   record's key — is being ENTERED; `.preview()` is a NAME and is shown
 *   wherever the value is REFERRED TO rather than edited; `.render()` is
 *   LAYOUT and applies only while the field is open in front of you.**
 *
 * The test that settles every case: **can the reader change something here?**
 * If yes it is a place for a description — the input beside a label, the key
 * box in "New entry", "Rename key", "Duplicate", "New page", the key half of a
 * reference dropdown. If no, it is a place for a preview — a list row, a
 * reference once chosen, a search hit, a sitemap row, the heading of what you
 * navigated to.
 *
 * That is why a description is plain data on the serialized schema and a
 * preview is a closure: a description is true before any value exists and says
 * the same thing to everyone filling the field in, and a preview cannot exist
 * without the one value it names. So a description must never be used as a
 * subtitle — it would repeat one sentence under every row of a list — and a
 * preview must never be used as help text, because there is nothing to preview
 * until after the value has been entered.
 *
 * None of the three substitutes for another: a field with a perfect
 * description still previews as `#3` until someone writes the preview.
 */
/**
 * A PREVIEW is how a VALUE is shown wherever a preview of it is needed — a row
 * in a sortable list, a key in a reference dropdown, a search hit, a
 * reference — which is everywhere the value is NAVIGABLE to rather than open.
 * It is never how the field itself is edited: that is a RENDER (`render.ts`),
 * which applies only when you are looking at the field. The two do not
 * intersect — a schema can carry both, and each is read in its own places.
 *
 * A preview is declared on the schema of the VALUE being previewed:
 *
 * ```ts
 * const author = s.object({ name: s.string() })
 *   .preview(({ val }) => ({ title: val.name }));
 * const authors = s.array(author);
 * ```
 *
 * The container reifies its rows by running each ITEM's preview closure — see
 * {@link ArrayPreview} / {@link RecordPreview}. (Previews used to be declared
 * on the container instead; a `.preview` on an array/record now previews the
 * array/record itself as a value, for when IT is the item of something.)
 */
/**
 * What a preview shows for one value: the user's `preview` callback returns
 * this, and the Studio draws a row from it.
 *
 * NB: {@link ArrayPreview} / {@link RecordPreview} name the DATA a container
 * previews with. The Studio also has React components called `ArrayPreview` /
 * `RecordPreview` (the fallback rendering of an array / record field, part of
 * the `<Type>Preview` convention in `components/Preview.tsx`). They do not
 * collide today because no file needs both - if one ever does, alias this type
 * at the import rather than renaming that convention.
 */
export type PreviewItem = {
  title: string;
  subtitle?: string | null;
  image?: ImageSource | null;
};

/**
 * What `.preview(...)` takes, on every schema: the value's own source in, a
 * {@link PreviewItem} out. `NonNullable` because a container skips null items
 * rather than previewing them.
 *
 * Declared through method syntax deliberately (the same bivariance shape
 * React's event handler types use): `nullable()` copies a schema's closure
 * into the `Src | null` variant of the same class, and with a plain function
 * type the checker cannot see that `NonNullable<Src | null>` IS
 * `NonNullable<Src>` while `Src` is still a type parameter — every schema's
 * `nullable()` would need a cast instead.
 */
export type ItemPreviewInput<Src> = {
  bivarianceHack(input: { val: NonNullable<Src> }): PreviewItem;
}["bivarianceHack"];

export type RecordPreview = {
  parent: "record";
  items: [key: string, value: PreviewItem][];
};

export type ArrayPreview = {
  parent: "array";
  /**
   * The previewed items, each PAIRED WITH ITS INDEX - the same
   * `[key, value][]` shape {@link RecordPreview} uses.
   *
   * Not a positionally-indexed array, and the reason is
   * {@link PreviewScope}: a preview computed for a subset of paths carries only
   * those items, so `items[i]` would silently read the wrong row. Carrying the
   * index makes a windowed preview impossible to misread - a consumer looks its
   * index up rather than trusting a position - and makes the array and record
   * shapes symmetric.
   */
  items: [index: number, value: PreviewItem][];
};

/**
 * How a CONTAINER's children preview. `parent` is the discriminant, and every
 * consumer narrows on it rather than on the union as a whole. There is no
 * `layout` here on purpose - how a preview is laid out is the editor's
 * business, not the schema's.
 */
export type PreviewRows = RecordPreview | ArrayPreview;

type WithStatus<T> =
  | {
      status: "error";
      message: string;
    }
  | {
      // TODO: loading doesn't really belong in core - however this is used in other places where it does make sense and we figured... Why not just add it here?
      status: "loading";
      data?: T;
    }
  | {
      status: "success";
      data: T;
    };
/**
 * Everything known about ONE path, which is two independent things.
 *
 * They are separate fields rather than a union because a path can have both,
 * and that is not a corner case: `s.array(section).preview(...)` where
 * `section` also previews is a section list that shows its rows AND names
 * itself when it is nested in something. One of them would have had to win.
 *
 * - {@link self} - what THIS value is called, from its own schema's
 *   `.preview(...)`. This is the only answer for a value with no container to
 *   ask: a module root (whose `.preview` was never run before this existed) and
 *   any field of an object.
 * - {@link rows} - what its CHILDREN are called, from the ITEM schema's
 *   `.preview(...)`, reified by the container. Kept alongside `self` rather
 *   than derived from the children's `self` entries because a list needs every
 *   row in one answer, and because an EMPTY list still has to preview as an
 *   empty list - which is a fact about the schema, not about any value.
 */
export type PreviewNode = {
  self?: PreviewItem;
  rows?: PreviewRows;
};

export type ReifiedPreview = Record<
  SourcePath | ModuleFilePath,
  WithStatus<PreviewNode>
>;

/**
 * Fold `incoming` into `target`, path by path. MUTATES `target`.
 *
 * Every `executePreview` used to copy child results across with a plain
 * assignment, which was fine while one path held one thing. It no longer does:
 * a container writes `rows` at its own path and its `self` arrives from the
 * same walk, so an overwrite silently drops whichever landed first. Merging is
 * per FIELD, and an error at a path beats any data there - a preview that threw
 * must not be reported as a preview that is merely absent.
 */
export function mergePreviewInto(
  target: ReifiedPreview,
  incoming: ReifiedPreview,
): void {
  for (const keyS in incoming) {
    const key = keyS as SourcePath | ModuleFilePath;
    const next = incoming[key];
    const current = target[key];
    if (current === undefined || next.status === "error") {
      target[key] = next;
      continue;
    }
    if (current.status === "error" || next.status === "loading") {
      continue;
    }
    if (current.status === "loading") {
      target[key] = next;
      continue;
    }
    target[key] = {
      status: "success",
      data: { ...current.data, ...next.data },
    };
  }
}

/**
 * Which paths a preview is being computed FOR.
 *
 * `executePreview` takes a whole module, so one request has always walked every
 * node in it and run every `preview` closure - for `handboka`, with `preview` at
 * two nested array levels, that is every chapter and every section to serve one
 * visible row. A scope is what makes the walk proportional to what is being
 * looked at instead of to the project.
 *
 * Two questions, because a container and its items need different answers:
 *
 * - {@link PreviewScope.wants} - is a preview AT this exact path wanted? A
 *   container answers `true` here when the whole of it is being shown, and its
 *   preview is then computed in full.
 * - {@link PreviewScope.wantsUnder} - could anything at or below this path be
 *   wanted? Recursion is pruned where this is `false`, and a container whose own
 *   path is not wanted but which has wanted descendants previews a WINDOW: only
 *   the items that were asked for. That is the case a single visible row is, and
 *   it is why {@link ArrayPreview} carries indices.
 *
 * Absent scope means the whole module, which is what every existing caller
 * passes and what every existing caller got.
 */
export type PreviewScope = {
  wants(path: SourcePath | ModuleFilePath): boolean;
  wantsUnder(path: SourcePath | ModuleFilePath): boolean;
};

/**
 * A scope covering exactly `paths` and their subtrees.
 *
 * Compares SEGMENTS rather than string prefixes. A source path's module path is
 * a quoted, dot-joined encoding (`?p="a".1."b"`), so `startsWith` gets the
 * ancestor test wrong wherever a key is a prefix of a sibling key or contains a
 * dot or a quote - `"title"` against `"titles"` being the cheapest example.
 * Segments are parsed once here, not per comparison.
 */
export function previewScope(paths: readonly SourcePath[]): PreviewScope {
  const wanted = paths.map((path) => {
    const [moduleFilePath, modulePath] = splitModuleFilePathAndModulePath(path);
    return {
      moduleFilePath,
      segments: modulePath === "" ? [] : splitModulePath(modulePath),
    };
  });
  const parse = (path: SourcePath | ModuleFilePath) => {
    const [moduleFilePath, modulePath] = splitModuleFilePathAndModulePath(path);
    return {
      moduleFilePath,
      segments: modulePath === "" ? [] : splitModulePath(modulePath),
    };
  };
  const isPrefix = (prefix: string[], of: string[]): boolean => {
    if (prefix.length > of.length) return false;
    for (let i = 0; i < prefix.length; i++) {
      if (prefix[i] !== of[i]) return false;
    }
    return true;
  };
  return {
    wants(path) {
      const at = parse(path);
      return wanted.some(
        (entry) =>
          entry.moduleFilePath === at.moduleFilePath &&
          entry.segments.length === at.segments.length &&
          isPrefix(entry.segments, at.segments),
      );
    },
    wantsUnder(path) {
      const at = parse(path);
      return wanted.some(
        (entry) =>
          entry.moduleFilePath === at.moduleFilePath &&
          // Either direction: a wanted path below `path` means recurse into it,
          // and a wanted path ABOVE it means the whole subtree was asked for.
          (isPrefix(at.segments, entry.segments) ||
            isPrefix(entry.segments, at.segments)),
      );
    },
  };
}

// TODO: improve this so that we do not get RawString and string, only string. Are there other things?
export type PreviewSelector<T extends Schema<SelectorSource>> =
  T extends Schema<infer S> ? S : never;
