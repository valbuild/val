import { Schema } from "./schema";
import { SelectorSource } from "./selector";
import { ImageSource } from "./source/media";
import { splitModuleFilePathAndModulePath, splitModulePath } from "./module";
import { ModuleFilePath, SourcePath } from "./val";

/**
 * What a container shows for ONE of its items: the user's `preview` callback
 * returns this, and the Studio draws a row from it.
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
 * Main preview type.
 *
 * Deliberately not exported: `parent` is the discriminant, and every consumer
 * narrows on it rather than on the union as a whole. There is no `layout` here
 * on purpose - how a preview is laid out is the editor's business, not the
 * schema's.
 */
type PreviewTypes = RecordPreview | ArrayPreview;

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
export type ReifiedPreview = Record<
  SourcePath | ModuleFilePath,
  WithStatus<PreviewTypes>
>;

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
