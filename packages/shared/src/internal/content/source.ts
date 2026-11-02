import type { Json, ModuleFilePath } from "@valbuild/core";
import type { ModuleVersion } from "./version";

/**
 * Where a reader's content comes from, in one shape: see
 * `docs/plans/one-content-model.md`, "One way to load". Every reader --
 * `fetchVal` on the server, `useVal` in the browser, and (phase 5) the
 * Studio -- asks a list of these, and only the list differs between them.
 *
 * Types only, here, because the sources are written on both sides of a
 * package line: the browser's (`@valbuild/react`) and the server's
 * (`@valbuild/server`, which cannot import React's package), and the one
 * rule that picks between them (`layered`) has to read both.
 */

/** What a source says about one module. */
export type ModuleRead =
  | {
      status: "ready";
      source: Json;
      /** Which source answered: goes into a reader's reads, and test frames. */
      from: string;
      /** The version of what it answered, where the source carries one. */
      version: ModuleVersion | null;
    }
  /** No say here: ask the next source. */
  | { status: "pass" }
  /** Will have a say: wait for `ready`, then ask again. */
  | { status: "pending"; ready: Promise<void> };

/**
 * What a source says about one `.jsonValues()` entry: the same as a module,
 * plus `gone` -- an ANSWER, "this entry is not there" (a pending patch removed
 * it), which is not the same as `pass`, "I cannot say". Collapsing the two is
 * what once made a deleted entry keep rendering its published content.
 */
export type EntryRead =
  | { status: "ready"; content: unknown; from: string }
  | { status: "gone"; from: string }
  | { status: "pass" }
  | { status: "pending"; ready: Promise<void> }
  /** The source tried and could not: an entry's import that rejected. */
  | { status: "failed"; error: unknown };

export interface ContentSource {
  /** `overlay`, `server-draft`, `snapshot`, `bundle`: what `from` says. */
  readonly name: string;
  module(path: ModuleFilePath): ModuleRead;
  entry(path: ModuleFilePath, key: string): EntryRead;
  /** Call `onChange` when a read of `paths` may answer differently. */
  subscribe?(
    paths: readonly ModuleFilePath[],
    onChange: () => void,
  ): () => void;
  /**
   * A string that changes exactly when a read of `paths` would: what a hook
   * hands `useSyncExternalStore`, compared with `===`.
   */
  revision?(paths: readonly ModuleFilePath[]): string;
}
