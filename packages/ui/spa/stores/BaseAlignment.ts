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
export type FetchBaseSources = (sourcesSha: string) => Promise<{
  sourcesSha: string;
  sources: Record<ModuleFilePath, Json>;
} | null>;

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
  private fetched: {
    sourcesSha: string;
    sources: Record<ModuleFilePath, Json>;
  } | null = null;

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

  listenTo(stat: StatStore): () => void {
    stat.setPreparer((snapshot) => this.prepare(snapshot));
    return this.host.events.on("host:base-received", (event) => {
      this.current = event.sourcesSha;
      // A re-intake put the bundle's source back. If the chain in place is
      // another build's, that build's base goes back under it.
      const last = this.lastStat;
      if (last?.sourcesSha === undefined || last.sourcesSha === this.current) {
        return;
      }
      const prepared = this.prepare(last);
      if (typeof prepared === "function") {
        prepared();
      } else {
        void prepared.then((commit) => {
          if (this.lastStat === last) commit();
        });
      }
    });
  }

  private prepare(
    snapshot: StatSnapshot,
  ): (() => boolean) | Promise<() => boolean> {
    const adopt = () => {
      this.lastStat = snapshot;
      return true;
    };
    const wanted = snapshot.sourcesSha;
    // Not reported, or no base yet: intake will compare when it lands.
    if (wanted === undefined || this.current === null) return adopt;
    if (wanted === this.current) return adopt;

    const unaligned = (why: string, detail: Record<string, unknown>) => {
      console.warn(`Val: ${why}`, { sourcesSha: wanted, ...detail });
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
      return this.commit(snapshot, known.sources, wanted, adopt, []);
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
            console.warn(
              "Val: could not fetch the base a change list belongs on",
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
      return this.commit(
        snapshot,
        base.sources,
        wanted,
        adopt,
        resolved.leaving,
      );
    });
  }

  private commit(
    snapshot: StatSnapshot,
    sources: Record<ModuleFilePath, Json>,
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
      this.sourceStore.rebase(sources, chain);
      this.current = sourcesSha;
      this.heldBack = null;
      return adopt();
    };
  }
}
