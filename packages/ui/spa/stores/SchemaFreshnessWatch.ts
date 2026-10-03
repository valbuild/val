import type { HostStore } from "./HostStore";
import type { StatStore } from "./StatStore";
import type { StatusStore } from "./StatusStore";

/**
 * How long a disagreement has to last before it is believed. See
 * {@link SchemaFreshnessWatch}.
 */
export const SCHEMA_DISAGREEMENT_GRACE_MS = 3_000;

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
 */
export class SchemaFreshnessWatch {
  private agreed = false;
  private timer: ReturnType<typeof setTimeout> | null = null;

  constructor(
    private readonly host: HostStore,
    private readonly stat: StatStore,
    private readonly status: StatusStore,
    private readonly graceMs = SCHEMA_DISAGREEMENT_GRACE_MS,
  ) {}

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
    if (!this.disagree()) {
      this.cancel();
      return;
    }
    if (this.timer !== null) return;
    this.timer = setTimeout(() => {
      this.timer = null;
      if (this.disagree()) this.status.reportSchemaOutOfDate();
    }, this.graceMs);
  }

  private cancel(): void {
    if (this.timer === null) return;
    clearTimeout(this.timer);
    this.timer = null;
  }
}
