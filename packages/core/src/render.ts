import { Schema } from "./schema";
import { ImageMetadata } from "./schema/image";
import { SelectorSource } from "./selector";
import { ImageSource } from "./source/image";
import { RemoteSource } from "./source/remote";
import { splitModuleFilePathAndModulePath, splitModulePath } from "./module";
import { ModuleFilePath, SourcePath } from "./val";

// TODO: we want to change layout -> as to be more consistent across the board
export type ListRecordRender = {
  layout: "list";
  parent: "record";
  items: [
    key: string,
    value: {
      title: string;
      subtitle?: string | null;
      image?: ImageSource | RemoteSource<ImageMetadata> | null;
    },
  ][];
};

export type ListArrayRender = {
  layout: "list";
  parent: "array";
  /**
   * The rendered items, each PAIRED WITH ITS INDEX — the same
   * `[key, value][]` shape {@link ListRecordRender} uses.
   *
   * Not a positionally-indexed array, and the reason is
   * {@link RenderScope}: a render computed for a subset of paths carries only
   * those items, so `items[i]` would silently read the wrong row. Carrying the
   * index makes a windowed render impossible to misread — a consumer looks its
   * index up rather than trusting a position — and makes the array and record
   * shapes symmetric.
   */
  items: [
    index: number,
    value: {
      title: string;
      subtitle?: string | null;
      image?: ImageSource | RemoteSource<ImageMetadata> | null;
    },
  ][];
};

export type TextareaRender = {
  layout: "textarea";
};

export type CodeLanguage =
  | "typescript"
  | "javascript"
  | "javascriptreact"
  | "typescriptreact"
  | "json"
  | "java"
  | "html"
  | "css"
  | "xml"
  | "markdown"
  | "sql"
  | "python"
  | "rust"
  | "php"
  | "go"
  | "cpp"
  | "sass"
  | "vue"
  | "angular";
export type CodeRender = {
  layout: "code";
  language: CodeLanguage;
};

// Main render type:
type RenderTypes =
  | ListRecordRender
  | ListArrayRender
  | TextareaRender
  | CodeRender;
//

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
export type ReifiedRender = Record<
  SourcePath | ModuleFilePath,
  WithStatus<RenderTypes>
>;

/**
 * Which paths a render is being computed FOR.
 *
 * `executeRender` takes a whole module, so one request has always walked every
 * node in it and run every `select` closure — for `handboka`, with `select` at
 * two nested array levels, that is every chapter and every section to serve one
 * visible row. A scope is what makes the walk proportional to what is being
 * looked at instead of to the project.
 *
 * Two questions, because a container and its items need different answers:
 *
 * - {@link RenderScope.wants} — is a render AT this exact path wanted? A
 *   container answers `true` here when the whole of it is being shown, and its
 *   list render is then computed in full.
 * - {@link RenderScope.wantsUnder} — could anything at or below this path be
 *   wanted? Recursion is pruned where this is `false`, and a container whose own
 *   path is not wanted but which has wanted descendants renders a WINDOW: only
 *   the items that were asked for. That is the case a single visible row is, and
 *   it is why {@link ListArrayRender} carries indices.
 *
 * Absent scope means the whole module, which is what every existing caller
 * passes and what every existing caller got.
 */
export type RenderScope = {
  wants(path: SourcePath | ModuleFilePath): boolean;
  wantsUnder(path: SourcePath | ModuleFilePath): boolean;
};

/**
 * A scope covering exactly `paths` and their subtrees.
 *
 * Compares SEGMENTS rather than string prefixes. A source path's module path is
 * a quoted, dot-joined encoding (`?p="a".1."b"`), so `startsWith` gets the
 * ancestor test wrong wherever a key is a prefix of a sibling key or contains a
 * dot or a quote — `"title"` against `"titles"` being the cheapest example.
 * Segments are parsed once here, not per comparison.
 */
export function renderScope(paths: readonly SourcePath[]): RenderScope {
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
export type RenderSelector<T extends Schema<SelectorSource>> =
  T extends Schema<infer S> ? S : never;
