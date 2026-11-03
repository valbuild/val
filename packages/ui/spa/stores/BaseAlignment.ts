import { Internal } from "@valbuild/core";
import type { Json, ModuleFilePath, PatchId } from "@valbuild/core";
import type { HostStore } from "./HostStore";
import type { PatchStore } from "./PatchStore";
import type { SourceStore } from "./SourceStore";
import type { StatSnapshot, StatStore } from "./StatStore";

/**
 * Another build's base source, by the `sourcesSha` its `/stat` answers carry.
 *
 * Resolves to what the server actually sent, sha included: the request can be
 * answered by yet another build, and only a base whose sha is the one asked for
 * belongs under that stat's chain.
 */
export type FetchBaseSources = (
  sourcesSha: string,
) => Promise<FetchedBase | null>;

/**
 * A base, and the schema each of its modules was evaluated with, by the
 * version the server names it by (`ModuleVersion.schema`). Absent from a
 * server that answers no versions: then every module is taken.
 */
export type FetchedBase = {
  sourcesSha: string;
  sources: Record<ModuleFilePath, Json>;
  schemas?: Record<ModuleFilePath, string>;
};

/**
 * Keeps the Studio's BASE and CHAIN from the same build.
 *
 * The Studio shows base + chain. The base is the source in the bundle it loaded;
 * the chain is what `/stat` announces, and `/stat` answers relative to the build
 * that answered IT: the patches that build does not contain. After a publish
 * those are two different builds for a while -- the platform's pointer lags per
 * location, and a tab opened before the publish keeps its bundle -- and applying
 * one build's chain to another's source either loses the edits in between or
 * applies them twice. A `replace` twice is invisible; a `move` twice reorders the
 * list again. `baseAndChain.test.ts` is every combination.
 *
 * So a stat whose `sourcesSha` is not the base's is not adopted until the base
 * it belongs on is in place: that build's source is fetched, and so are the
 * records its chain names that this client does not hold, and then -- in one
 * turn -- the patches the new base already contains leave the chain, the base
 * is replaced (which replays what is left of the chain on top), and the stat is
 * adopted. Nothing renders in between.
 *
 * Going back to the bundle's own build needs no fetch: its source is kept.
 */
export class BaseAlignment {
  /** The `sourcesSha` of the base in the source store, or `null` before intake. */
  private current: string | null = null;
  /** The last stat adopted, so a re-intake (HMR) can be put back under it. */
  private lastStat: StatSnapshot | null = null;
  /** The last fetched base. One: the case is a pointer catching up, not a history. */
  private fetched: FetchedBase | null = null;

  /**
   * Whether the source store's base has been in step with the server's chain
   * at least once: see {@link onAligned}. Never goes back to `false` -- every
   * later swap happens in one turn, so nothing out of step is on screen.
   */
  private aligned = false;
  private alignedListeners = new Set<() => void>();

  /**
   * Modules whose schema this Studio moved to by new code (HMR, staged code
   * the tab evaluated) and no build has answered with yet: the Studio is
   * AHEAD of the server there, and only there is a base the server's build
   * evaluated with another schema left out. See {@link underOurSchemas}.
   */
  private ahead = new Set<ModuleFilePath>();

  /**
   * New code moved these modules' schemas (`schema:init` after the first
   * intake): until a build answers with them, this Studio is ahead of the
   * server for them.
   */
  codeMoved(modules: readonly ModuleFilePath[]): void {
    // The first intake is where the Studio starts, not a move.
    if (this.current === null) return;
    for (const moduleFilePath of modules) this.ahead.add(moduleFilePath);
  }

  constructor(
    private readonly host: HostStore,
    private readonly sourceStore: SourceStore,
    private readonly patchStore: PatchStore,
    private readonly fetchBase: FetchBaseSources | undefined,
  ) {}

  /**
   * The build whose stat was last held back because its chain could not be
   * completed. Held back ONCE: the next stat from that build tries again, and
   * if that fails too it is adopted as it stands -- the old behaviour, and the
   * one whose own reporting names a record the server will not send. A Studio
   * that stops taking stats is worse than one that is briefly wrong.
   */
  private heldBack: string | null = null;

  /**
   * Call `listener` once the base and the chain first belong together: a stat
   * adopted after intake, on the base it names, or adopted as it stands
   * because no better base is coming. At once if that has happened already.
   *
   * Until then the source store holds the bundle's source -- which after a
   * publish can be the build from before it -- so a page shown what the store
   * holds is shown the old text, and then the new text once the base is
   * swapped: the flicker of a draft page after a publish. What hands source
   * to a page waits for this (`ValOverlayEmitter`, the canvas relay).
   */
  onAligned(listener: () => void): () => void {
    if (this.aligned) {
      listener();
      return () => {};
    }
    this.alignedListeners.add(listener);
    return () => {
      this.alignedListeners.delete(listener);
    };
  }

  private markAligned(): void {
    if (this.aligned || this.current === null) return;
    this.aligned = true;
    const listeners = [...this.alignedListeners];
    this.alignedListeners.clear();
    for (const listener of listeners) listener();
  }

  listenTo(stat: StatStore): () => void {
    stat.setPreparer((snapshot) => this.prepare(snapshot));
    return this.host.events.on("host:base-received", (event) => {
      this.current = event.sourcesSha;
      // A re-intake (HMR) put the bundle's source back under whatever chain is
      // in place. If that chain is another build's, its base goes back -- in
      // this turn, so the bundle's source under it is never on screen.
      const last = this.lastStat;
      const wanted = last?.sourcesSha;
      if (wanted === undefined || wanted === this.current) {
        // A stat adopted before intake, naming this build or none.
        if (last !== null) this.markAligned();
        return;
      }
      if (this.fetched?.sourcesSha === wanted) {
        // Restoring what was showing, not adopting anything: no stat moves, so
        // a newer one being prepared is not overtaken.
        this.sourceStore.rebase(
          this.underOurSchemas(this.fetched),
          this.patchStore.chainRecords(),
        );
        this.current = wanted;
        this.markAligned();
        return;
      }
      // The base is not held (it cannot be, short of a failed fetch): prepare
      // the stat again, as a stat, so a newer one still wins.
      stat.readopt();
    });
  }

  private prepare(
    snapshot: StatSnapshot,
  ): (() => boolean) | Promise<() => boolean> {
    const adopt = () => {
      this.lastStat = snapshot;
      // Before intake there is no base to be in step with: intake decides.
      this.markAligned();
      return true;
    };
    const wanted = snapshot.sourcesSha;
    // Not reported, or no base yet: intake will compare when it lands.
    if (wanted === undefined || this.current === null) return adopt;
    if (wanted === this.current) return adopt;

    const unaligned = (why: string, detail: Record<string, unknown>) => {
      Internal.log.debug(`${why}`, { sourcesSha: wanted, ...detail });
      if (this.heldBack === wanted) {
        this.heldBack = null;
        return adopt;
      }
      this.heldBack = wanted;
      return () => false;
    };

    const bundle = this.host.bundleBase();
    const known =
      bundle?.sourcesSha === wanted
        ? bundle
        : this.fetched?.sourcesSha === wanted
          ? this.fetched
          : null;
    const omitted = this.patchStore.omittedUnplaced(snapshot.patches);
    const incomplete = "could not settle every change the swap depends on";

    // Everything already here: swap in this turn. This is the re-intake case
    // (HMR) -- the bundle's source was just put back under another build's
    // chain, and waiting even one turn to undo that is a frame of it on screen.
    if (
      known !== null &&
      omitted.length === 0 &&
      this.patchStore.holdsAll(snapshot.patches)
    ) {
      return this.commit(snapshot, known, wanted, adopt, []);
    }
    if (known === null && this.fetchBase === undefined) return adopt;

    // The base, the records this chain adds, and where the patches it leaves
    // out stand -- all three before anything moves, because the base without
    // any one of them is a state that is wrong on screen.
    const fetchBase = this.fetchBase;
    return Promise.all([
      known !== null || fetchBase === undefined
        ? Promise.resolve(known)
        : fetchBase(wanted).catch((error: unknown) => {
            Internal.log.debug(
              "could not fetch the base a change list belongs on",
              { sourcesSha: wanted, error },
            );
            return null;
          }),
      this.patchStore.stage(snapshot.patches),
      this.patchStore.resolveOmitted(omitted),
    ]).then(([base, staged, resolved]) => {
      if (base === null) {
        return unaligned("no base for a change list from another build", {});
      }
      if (base.sourcesSha !== wanted) {
        // Answered by a third build: the pointer that made this stat differ
        // moved again.
        return unaligned("the base fetched came from yet another build", {
          got: base.sourcesSha,
        });
      }
      if (base !== known) this.fetched = base;
      if (!staged || !resolved.complete) return unaligned(incomplete, {});
      return this.commit(snapshot, base, wanted, adopt, resolved.leaving);
    });
  }

  /**
   * The modules of `base` this Studio may put under its fields.
   *
   * A module whose schema NEW CODE moved this Studio to ({@link ahead}), and
   * which the answering build evaluated with another schema, keeps the base
   * it has: the one this Studio's own code wrote. Put under the new schema,
   * the old build's base is content read with a schema it was not made for:
   * in local development HMR reaches the page and the server in either
   * order, and when the page is first, the old server's base has no field
   * the new code added. An edit to that field then failed against the old
   * base and was deleted (S10b, the reverting field). Kept, the edit applies
   * here at once, and on the server once it has the code -- the chain is the
   * same either way: in fs and memory mode it is the store's, relative to
   * whatever the newest code evaluated. The same holds for staged code the
   * tab evaluated, before the proposal is built (C11).
   *
   * Only when the Studio is AHEAD. A build that answers with newer code than
   * this Studio's -- a deploy while it was open, a proposal built without the
   * tab evaluating it -- has the base that is right for its chain, and the
   * Studio cannot read it with the new schema until it has that schema
   * (hosted, a reload: `SchemaFreshnessWatch`, until a build's registry can
   * be swapped in, `docs/plans/one-content-model.md` phase 9). Keeping the
   * old base there would drop what that build already contains -- the edits
   * a proposal's build was made with -- for nothing.
   *
   * A build that answers with the Studio's schema has caught up: the module
   * is no longer ahead.
   */
  private underOurSchemas(base: FetchedBase): Record<ModuleFilePath, Json> {
    // The bundle's own base was written by this Studio's code: in step.
    if (base === this.host.bundleBase()) this.ahead.clear();
    const schemas = base.schemas;
    if (schemas === undefined) return base.sources;
    const sources: Record<ModuleFilePath, Json> = {};
    const kept: ModuleFilePath[] = [];
    for (const [path, source] of Object.entries(base.sources)) {
      if (!isModuleFilePath(path)) continue;
      const theirs = schemas[path];
      const ours = this.sourceStore.schemaVersionOfModule(path);
      if (theirs !== undefined && theirs === ours) {
        this.ahead.delete(path);
      } else if (
        theirs !== undefined &&
        ours !== undefined &&
        this.ahead.has(path)
      ) {
        kept.push(path);
        continue;
      }
      sources[path] = source;
    }
    if (kept.length > 0) {
      Internal.log.debug(
        "kept this Studio's base for modules another build evaluated with another schema",
        { sourcesSha: base.sourcesSha, modules: kept },
      );
    }
    return sources;
  }

  private commit(
    snapshot: StatSnapshot,
    base: FetchedBase,
    sourcesSha: string,
    adopt: () => boolean,
    /** Omitted patches the server says have shipped or are gone. */
    leaving: readonly PatchId[],
  ): () => boolean {
    return () => {
      // The patches this base already contains -- or that no longer exist --
      // leave the chain, from both stores; then the base goes in with the chain
      // that belongs on it, in the server's order, fetched records included.
      const shipped = [
        ...this.patchStore.shippedOutside(snapshot.patches),
        ...leaving,
      ];
      if (shipped.length > 0) {
        this.sourceStore.forgetPublished(shipped);
        this.patchStore.forgetPublished(shipped);
      }
      const chain = this.patchStore.takeStaged(snapshot.patches);
      // Filtered as it goes in, not when it was fetched: the schemas may have
      // moved in between (HMR).
      this.sourceStore.rebase(this.underOurSchemas(base), chain);
      this.current = sourcesSha;
      this.heldBack = null;
      return adopt();
    };
  }
}

function isModuleFilePath(path: string): path is ModuleFilePath {
  return path.startsWith("/");
}
