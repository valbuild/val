import { Internal, type ModuleFilePath } from "@valbuild/core";
import type {
  ContentSource,
  EntryRead,
  ModuleRead,
} from "@valbuild/shared/internal";

/**
 * The rule that content is only read with the schema it was made for
 * (`docs/plans/one-content-model.md`, goal 3).
 *
 * `schemaOf(path)` is the version of the schema the READER's code has for a
 * module (`null`: not known, so no rule). A source whose answer names
 * another schema is not read: with `codeChanged` the read waits until the
 * code catches up; without it the next source answers, which ends at the
 * reader's own bundle -- content of the code that reads it.
 */
export type SchemaRule = {
  schemaOf(path: ModuleFilePath): string | null;
  codeChanged?(path: ModuleFilePath, schema: string): Promise<void>;
};

/** A module read, with the place in the list of the source that answered it. */
export type LocatedRead = {
  read: ModuleRead;
  /** The index of the source that answered; `-1` when none did. */
  at: number;
};

/** What `layered` gives back: one view over the sources, first answer wins. */
export type View = {
  readonly sources: readonly ContentSource[];
  module(path: ModuleFilePath): LocatedRead;
  /** An entry, from the sources after `after` (all of them by default). */
  entry(path: ModuleFilePath, key: string, after?: number): EntryRead;
  subscribe(paths: readonly ModuleFilePath[], onChange: () => void): () => void;
  revision(paths: readonly ModuleFilePath[]): string;
};

const PASS: ModuleRead = { status: "pass" };

/**
 * The ONE place that decides which source wins: the first that does not
 * pass. Replaces the source-priority arrays each reader wrote inline
 * (`[draft, snapshot]`, then the bundle, in four places), and is the only
 * place the schema rule is applied.
 */
export function layered(
  sources: readonly ContentSource[],
  rule?: SchemaRule,
  /**
   * Waits that are already over. A source still answering one of them is
   * passed over: what it waited for came and did not give it an answer (draft
   * mode stayed unknown, a module the Studio never sent), and the read goes on
   * as it would have without waiting.
   */
  settled?: ReadonlySet<Promise<void>>,
): View {
  return {
    sources,
    module(path) {
      for (let at = 0; at < sources.length; at++) {
        const source = sources[at];
        if (source === undefined) continue;
        const read = source.module(path);
        if (read.status === "pass") continue;
        if (read.status === "pending" && settled?.has(read.ready)) continue;
        if (read.status === "ready" && read.version !== null && rule) {
          const own = rule.schemaOf(path);
          if (own !== null && own !== read.version.schema) {
            if (rule.codeChanged) {
              return {
                read: {
                  status: "pending",
                  ready: rule.codeChanged(path, read.version.schema),
                },
                at,
              };
            }
            Internal.log.debug(
              `${path} from ${read.from} was made with another schema than this code has; reading the next source`,
            );
            continue;
          }
        }
        return { read, at };
      }
      return { read: PASS, at: -1 };
    },
    entry(path, key, after = -1) {
      for (let at = after + 1; at < sources.length; at++) {
        const read = sources[at]?.entry(path, key);
        if (read === undefined || read.status === "pass") continue;
        if (read.status === "pending" && settled?.has(read.ready)) continue;
        return read;
      }
      return { status: "pass" };
    },
    subscribe(paths, onChange) {
      const offs = sources.map(
        (source) => source.subscribe?.(paths, onChange) ?? (() => {}),
      );
      return () => {
        for (const off of offs) off();
      };
    },
    revision(paths) {
      return sources.map((source) => source.revision?.(paths) ?? "").join("|");
    },
  };
}
