import type { HostStore } from "./HostStore";
import type { StatStore } from "./StatStore";
import type { StatusStore } from "./StatusStore";

/**
 * How long a disagreement has to last before it is believed. See
 * {@link SchemaFreshnessWatch}.
 */
export const SCHEMA_DISAGREEMENT_GRACE_MS = 3_000;

/**
 * Ask the server, now, which schema it runs. `null` when it could not say.
 * See {@link SchemaFreshnessWatch}.
 */
export type ReadServedSchemaSha = () => Promise<string | null>;

/** The longest wait between fresh reads that keep failing. */
const MAX_SCHEMA_READ_BACKOFF_MS = 60_000;

/**
 * Tells the editor to reload when the server is running a schema this page is
 * not.
 *
 * The one thing a reload is ALLOWED to change is the schema — and then the
 * Studio has to say so, rather than go on resolving fields against a shape
 * that has been replaced. `StatusStore.reportSchemaOutOfDate` and the dialog
 * behind it existed for this, and nothing called them: the comparison was lost
 * when the stores replaced the sync engine, so a Studio open across a schema
 * deploy edited against the old schema until somebody happened to reload.
 *
 * The comparison is between the schema this page RUNS (`HostStore.schemaSha`,
 * recomputed on every intake, an HMR re-run included) and the one the server
 * runs (`schemaSha` on `/stat`). Both are the same fold, `computeSchemaSha`.
 * Two rules keep it from ever reporting something a reload would not fix:
 *
 * - **Not until the two have agreed once.** A tab can load a new bundle and be
 *   answered by the old build for a while (the platform's pointer lags per
 *   location), and a reload would not fix that — it would load the same
 *   bundle and be answered by the same build. And if the two folds ever
 *   disagreed for a reason that is not a deploy, reporting from the first stat
 *   would put every load behind a dialog that reloads into the same dialog.
 *   Agreeing once proves the comparison works on this page, and a schema
 *   that moves after that is a deploy.
 * - **Not until it has lasted {@link SCHEMA_DISAGREEMENT_GRACE_MS}.** In dev a
 *   schema edit reaches the server's `/stat` and this page's HMR re-intake in
 *   either order. Reported on the first, the dialog — which is one-way by
 *   design — would block an editor that already has the new schema.
 *
 * And what settles it is a FRESH answer, asked for when the grace is up
 * (`readServedSchemaSha`), never the last one cached. `/stat` has more than one
 * caller, and during a deploy the old build and the new one both answer — at
 * the same chain version, since a schema deploy does not move the chain — so
 * the cached answer is whichever happened to land last. A late one from the
 * old build would ask a page that has just reloaded into the new schema to
 * reload again; one landing after the new build's would hide the deploy until
 * the next stat, which with a websocket is twenty minutes away. So once the
 * two have disagreed, an answer that agrees again does not cancel the check:
 * the fresh read decides, either way. Ordering the answers by when they were
 * asked would not do it: in dev the poll is a long one, asked long before it
 * is answered.
 */
export class SchemaFreshnessWatch {
  private agreed = false;
  private timer: ReturnType<typeof setTimeout> | null = null;
  /** A disagreement was seen, and no fresh read has settled it yet. */
  private unsettled = false;
  /** Fresh reads in a row that came back with no answer. */
  private failedReads = 0;
  /** A fresh read is out. There is never more than one. */
  private reading = false;
  /** The schemas moved while it was out, so its answer cannot decide. */
  private changedDuringRead = false;
  /** The editor has been told to reload. */
  private reported = false;
  /** Torn down with the system. Nothing is read, scheduled or reported after. */
  private stopped = false;
  private readonly graceMs: number;
  private readonly readServedSchemaSha: ReadServedSchemaSha | undefined;

  constructor(
    private readonly host: HostStore,
    private readonly stat: StatStore,
    private readonly status: StatusStore,
    options: {
      graceMs?: number;
      /**
       * Without it — a driver with no server — the cached answer is all there
       * is, and the grace alone decides.
       */
      readServedSchemaSha?: ReadServedSchemaSha;
    } = {},
  ) {
    this.graceMs = options.graceMs ?? SCHEMA_DISAGREEMENT_GRACE_MS;
    this.readServedSchemaSha = options.readServedSchemaSha;
  }

  listen(): () => void {
    const offStat = this.stat.events.on("stat:schema", () => this.check());
    // `host:base-received`, not `host:receive`: it is emitted once the
    // intake's SHAs are in place.
    const offHost = this.host.events.on("host:base-received", () =>
      this.check(),
    );
    return () => {
      offStat();
      offHost();
      // A read still out answers into nothing: see `settle`.
      this.stopped = true;
      this.cancel();
    };
  }

  private disagree(): boolean {
    const running = this.host.schemaSha();
    const served = this.stat.currentSchemaSha();
    if (running === null || served === null) return false;
    if (running === served) {
      this.agreed = true;
      return false;
    }
    return this.agreed;
  }

  private check(): void {
    // One-way: once the editor has been told, there is nothing left to watch.
    if (this.reported) return;
    if (this.disagree()) {
      this.unsettled = true;
    } else if (this.readServedSchemaSha === undefined || !this.unsettled) {
      this.cancel();
      return;
    }
    if (this.reading) {
      // The read in flight was asked before this — its answer may already be
      // out of date. Another goes out after it, never beside it.
      this.changedDuringRead = true;
      return;
    }
    this.schedule(this.graceMs);
  }

  private schedule(delayMs: number): void {
    if (this.stopped || this.timer !== null) return;
    this.timer = setTimeout(() => {
      this.timer = null;
      void this.settle();
    }, delayMs);
  }

  private report(): void {
    this.reported = true;
    this.cancel();
    this.status.reportSchemaOutOfDate();
  }

  private async settle(): Promise<void> {
    if (this.reported || this.stopped) return;
    const read = this.readServedSchemaSha;
    if (read === undefined) {
      if (this.disagree()) this.report();
      return;
    }
    if (!this.unsettled || this.reading) return;
    this.reading = true;
    this.changedDuringRead = false;
    let served: string | null;
    try {
      served = await read();
    } catch {
      served = null;
    }
    this.reading = false;
    if (this.stopped) return;
    const running = this.host.schemaSha();
    if (served === null || running === null) {
      /*
       * No answer is not an answer. Falling back to the cached one would
       * bring back exactly what the fresh read is for — a late answer from the
       * old build opening a dialog that cannot be dismissed — so ask again,
       * backing off, until a read comes back.
       */
      this.failedReads += 1;
      this.schedule(
        Math.min(
          this.graceMs * 2 ** this.failedReads,
          MAX_SCHEMA_READ_BACKOFF_MS,
        ),
      );
      return;
    }
    this.failedReads = 0;
    if (this.changedDuringRead) {
      // Something moved while this read was out: it is asked again, so the
      // answer that decides was asked after everything it has to explain.
      this.changedDuringRead = false;
      this.schedule(this.graceMs);
      return;
    }
    this.unsettled = false;
    if (served !== running) {
      this.report();
      return;
    }
    /*
     * And the cache takes the answer. Left on the late answer that started
     * this, the next deploy could be a rollback TO that schema — its `/stat`
     * would then look like nothing changed, and never be checked.
     */
    this.stat.noteServedSchemaSha(served);
  }

  private cancel(): void {
    if (this.timer === null) return;
    clearTimeout(this.timer);
    this.timer = null;
  }
}
