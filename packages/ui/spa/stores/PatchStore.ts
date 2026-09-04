import { Internal, type ModuleFilePath, type PatchId } from "@valbuild/core";
import type { Json } from "@valbuild/core";
import type { Patch } from "@valbuild/core/patch";
import type { PatchGroupT } from "@valbuild/shared/internal";
import { StoreBus } from "./StoreBus";
import type {
  Head,
  PatchErrorEntry,
  PatchOrigin,
  PatchRecord,
  SystemEvent,
} from "./types";
import type { StatStore } from "./StatStore";
import type { SourceStore } from "./SourceStore";
import { noopActivity, type ActivitySink } from "./activity";
import { splitPatchFileOps } from "../hooks/splitPatchFileOps";
import type { ParentRef } from "@valbuild/shared/internal";

/**
 * Fetches the ops for patch ids the system knows about but has no data for.
 *
 * Injected rather than imported so the same store runs against `GET /patches`
 * in the app and against an in-memory table in a test. The signature is the
 * async one on purpose: this is genuinely a network call in the app, and the
 * `external-partial` head only exists because it can be in flight.
 */
export type FetchPatches = (patchIds: PatchId[]) => Promise<{
  patches: PatchRecord[];
  /**
   * The patch groups on this branch, as the server reported them.
   *
   * `undefined` means this deployment has no groups — `fs` mode, a content API
   * that predates them, or a lookup that failed — and staging stays off, which
   * is what every project does today. An empty ARRAY would be a different
   * claim: groups exist and hold nothing, which would turn staging on with
   * everything held. The two must not be folded together.
   *
   * Carried on the patch fetch rather than fetched separately because it is
   * read from the same response: `GET /patches` annotates the chain, and a
   * second round trip could only disagree with it.
   */
  patchGroups?: PatchGroupT[];
  /**
   * Per patch: why THIS patch could not be read.
   *
   * An id in here is kept in the chain — see `reconcileVanished`, which treats
   * "I could not read it" as evidence of nothing.
   */
  errors?: Record<PatchId, string>;
  /**
   * The REQUEST failed, so nothing was read.
   *
   * Separate from `errors` because it is one thing that went wrong rather than
   * N, and because it is the case worth telling the user about: a chain that
   * cannot be loaded means the editor is showing published content while
   * pending changes exist, which looks exactly like changes having been lost.
   * `errors` should still name every requested id, so nothing concludes the
   * patches are gone.
   */
  error?: string;
}>;

export type CreatePatchId = () => PatchId;

/**
 * One chain entry, as a reader AT A PATH sees it.
 *
 * The record plus the optimistic axis, because those are the two facts a review
 * row renders and they move independently: `markSaved` flips `isPending` while
 * the record stays exactly the same object.
 */
export type PatchAtPath = {
  record: PatchRecord;
  isPending: boolean;
};

/** Do these two answers about one path say the same thing? */
function samePatchesAtPath(a: PatchAtPath[], b: PatchAtPath[]): boolean {
  if (a.length !== b.length) return false;
  for (let index = 0; index < a.length; index++) {
    if (
      a[index].record !== b[index].record ||
      a[index].isPending !== b[index].isPending
    ) {
      return false;
    }
  }
  return true;
}

/**
 * Is this the same chain, in the same order?
 *
 * Order matters as much as membership — `/stat` is the authority on order, and
 * another session's patch landing between two of ours is a real change with an
 * identical id set. So this compares position by position rather than as sets.
 */
function sameOrder(a: readonly PatchId[], b: readonly PatchId[]): boolean {
  if (a.length !== b.length) return false;
  for (let index = 0; index < a.length; index++) {
    if (a[index] !== b[index]) return false;
  }
  return true;
}

/**
 * POST one file's bytes to wherever files live, or delete one.
 *
 * `data: null` IS the delete — the same operation in both directions, which is
 * how the server already models it (`saveBase64EncodedBinaryFileFromPatch`
 * deletes when handed null). One method rather than two means a caller cannot
 * upload through the seam and delete around it.
 *
 * Injected like {@link FetchPatches}, so the same store runs against
 * `POST {baseUrl}/patches/{patchId}/files` in FS mode, against the content host
 * in HTTP mode, and against an in-memory table in a test. Async because it is
 * genuinely a network call, and because the ordering below only means anything
 * if it can fail.
 */
export type UploadFile = (request: {
  patchId: PatchId;
  /**
   * The parent the patch carrying these bytes will name.
   *
   * Load-bearing, not metadata: `ValOpsFS` writes a patch's files into the
   * directory named by its parentRef and reads them back out of the directory
   * the PATCH ended up in. If the two disagree the bytes are on disk and the
   * image 404s. `null` when nothing has established a parent yet, which the
   * server reads as the head. (`ValOpsHttp` ignores it — its files are keyed by
   * patch id — so this matters in `fs` mode.)
   */
  parentRef: ParentRef | null;
  filePath: string;
  /** A data URL, or `null` to delete. */
  data: string | null;
  type: "file" | "image";
  remote: boolean;
  metadata?: Json;
  /**
   * Bytes sent so far, for THIS file.
   *
   * On the seam rather than nowhere, because an image upload is the one operation
   * here slow enough that a user needs to see it moving. The store cannot report
   * it — it does not do the sending — so the implementation reports and the store
   * forwards, adding which file of how many. Optional: an implementation that
   * cannot measure progress simply never calls it.
   */
  onProgress?: (bytesUploaded: number, totalBytes: number) => void;
}) => Promise<{ status: "ok" } | { status: "error"; message: string }>;

/** How far a patch's uploads have got. See {@link PatchStore.createPatch}. */
export type UploadProgress = (
  bytesUploaded: number,
  totalBytes: number,
  currentFile: number,
  totalFiles: number,
) => void;

/**
 * The result of creating a patch, which can fail before the patch exists.
 *
 * A union rather than a throw: a field has to render the failure, and an upload
 * failing is an ordinary outcome (offline, quota, a rejected mime type), not an
 * exceptional one.
 */
export type CreatePatchResult =
  | { status: "created"; record: PatchRecord }
  | {
      status: "upload-failed";
      message: string;
      /** Files that were uploaded and have since been cleaned up. */
      rolledBack: string[];
      /** Files that were uploaded and could NOT be cleaned up: orphans. */
      orphaned: string[];
    };

/**
 * Owns the patch chain: which patches exist, in what order, where each came
 * from, and which of them have data.
 *
 * It does NOT apply patches and does not hold source — {@link SourceStore} does
 * that. The split is what makes the head meaningful: the patch store knows a
 * patch exists, the source store knows whether it landed, and the head is where
 * those two facts meet.
 */
/**
 * Whether two group annotations say the same thing.
 *
 * Serialised rather than walked, the same way `usePatchSets` compares its
 * grouping: both sides come from a zod parse of a JSON body, so key order
 * follows the schema and is stable. The point is to keep the identity of an
 * unchanged annotation — most fetches carry one — because a fresh array is what
 * makes everything downstream treat it as news and repaint the review screen.
 */
function sameGroups(
  a: PatchGroupT[] | undefined,
  b: PatchGroupT[] | undefined,
): boolean {
  if (a === b) return true;
  if (a === undefined || b === undefined) return false;
  return JSON.stringify(a) === JSON.stringify(b);
}

export class PatchStore {
  readonly events = new StoreBus<SystemEvent>();

  /** The single linear chain, in apply order. */
  private ordered: PatchId[] = [];
  private dataById = new Map<PatchId, PatchRecord>();
  private originById = new Map<PatchId, PatchOrigin>();
  /** Learned from `source:patch-apply` — the source store is the authority. */
  /**
   * The patch groups the server last reported, or `undefined` if it reported
   * none.
   *
   * `undefined` and `[]` are different answers — see {@link FetchPatches} — so
   * this is deliberately not initialised to an empty array.
   */
  private patchGroups: PatchGroupT[] | undefined;
  /**
   * Moved by every change to {@link patchGroups} or {@link ownPatchGroupId},
   * and by nothing else. See the `patch:groups` event in `types.ts`.
   */
  private groupsVersionCounter = 0;
  /**
   * The group this client's own writes are landing in, as the server named it.
   *
   * Learned from the SAVE response, because there is nowhere else to learn it.
   * A write names no group — the content API resolves this author's open one
   * and creates it if absent — so on a fresh branch the group comes into
   * existence during a save. The chain annotation only refreshes when a fetch
   * has missing ids to ask for, and a patch this client made is never missing,
   * so the tab that bootstrapped the group would otherwise never see its id and
   * every stage would silently do nothing.
   *
   * Not merged into {@link patchGroups}: that is the SERVER's answer, membership
   * included, and this is one id with no membership attached. Kept apart so a
   * reader can tell a real group from a bare id.
   */
  private ownPatchGroupId: string | undefined;
  /**
   * Has this deployment got patch groups AT ALL?
   *
   * A fact about the deployment, so it is latched: once the server has answered
   * with a group annotation, or named the group one of our own saves joined,
   * groups exist here and cannot stop existing.
   *
   * It has to be its own flag because neither of the two things that reveal it
   * stays true. The annotation is ABSENT rather than empty where no group holds
   * anything, and {@link ownPatchGroupId} is deliberately forgotten on publish
   * — so straight after a publish, on a branch whose only group was the one
   * just closed, both were unset and the client concluded the deployment had no
   * groups. Staging vanished from the review screen and, far worse,
   * `usePatchGroupWrites` dropped the resolver, so the next write joined no
   * group and could not be published as part of one.
   */
  private patchGroupsSeen = false;
  private appliedIds = new Set<PatchId>();
  /**
   * Patches the source store reported as HELD — outside the reader's patch
   * group, so deliberately not applied.
   *
   * Separate from `appliedIds` because they answer different questions: applied
   * is "the effect is in the value", held is "we are done deciding about it".
   * {@link chainSettled} needs the second; every value reader needs the first.
   */
  private heldIds = new Set<PatchId>();
  private failedById = new Map<PatchId, string>();
  /** Ids announced by stat whose fetch is in flight, so we do not re-fetch. */
  private fetching = new Set<PatchId>();
  /**
   * Which field instance created each locally created patch.
   *
   * The same path can be rendered more than once — a studio field and an inline
   * overlay — so "this session made it" is too coarse to decide who to wake: what
   * is internal to one instance is foreign to the other.
   */
  private creatorByPatchId = new Map<PatchId, string>();
  /**
   * Which editing SESSION made each patch, where one said.
   *
   * Client-side like {@link creatorByPatchId}, but for a different reason: this one
   * is sent to the server, which stores it per patch. It is kept here rather than
   * on the record because `GET /patches` does not return it, so a record fetched
   * back would lose it and a record made here would appear to differ.
   *
   * It constrains BATCHING, which is the only reason the store has to know: the
   * `PUT` carries one `sessionId` for the whole request, so patches from different
   * sessions cannot share one. See `PatchSync.drain`.
   */
  private sessionByPatchId = new Map<PatchId, string>();
  /**
   * Locally created patches the server has not acknowledged yet.
   *
   * A THIRD axis, deliberately not folded into {@link Head}. The head already
   * carries origin (who made it) and status (did it apply), and "has the server
   * got it" is neither of those: a patch can be internal, applied and complete
   * while still existing only in this tab. Overloading `internal-partial` to
   * mean unsaved would make the read path — which is about whether a VALUE is
   * current — answer a question about durability, and a reader would then have
   * to distinguish "not applied" from "not saved" out of one word.
   *
   * Cleared by {@link markSaved}, not by anything on the read path.
   */
  private pendingIds = new Set<PatchId>();
  /**
   * Ids currently being checked against the server by
   * {@link reconcileVanished}.
   *
   * Stat polls, so the same absence is reported again every few seconds. Without
   * this, a patch that genuinely vanished would start a fresh round trip per
   * poll until the first one came back.
   */
  private verifying = new Set<PatchId>();
  /**
   * Ids one fetch answered with neither a record nor an error.
   *
   * A stat is a SNAPSHOT, and in `fs` mode a stale one is routine: `/stat` long
   * polls, so the patch list it returns was read when the poll opened and can be
   * up to a whole polling interval old by the time it is answered. A publish or a
   * discard inside that window leaves the response naming patches the server has
   * already deleted — and a fetch for them then comes back empty, which looks
   * exactly like the server contradicting itself.
   *
   * So one empty answer is not enough to report. The id leaves {@link fetching},
   * a LATER stat re-announces it if it really is still pending, the fetch runs
   * again, and only that second answer is evidence — because the confirmation
   * that matters is a stat issued after the delete, which is the only thing that
   * can tell a stale announcement from a wrong one.
   *
   * Cleared the moment the record arrives, or the id leaves the chain.
   */
  private notDeliveredOnce = new Set<PatchId>();
  /**
   * Is a publish in flight? Injected, because only `createSystem` knows.
   *
   * `/save` in `fs` mode DELETES the patches it published, so a stat poll landing
   * between the server committing and this client running `forgetPublished` sees
   * them gone from a chain that still holds them. Reconciling then confirms they
   * are absent — correctly — and drops them, rebuilding source from a base that
   * has not been promoted yet: every published field visibly reverts.
   *
   * There is nothing to reconcile during a publish anyway; the publish path
   * settles the chain itself.
   */
  private publishInFlight: () => boolean = () => false;
  /**
   * The `baseSha` the last stat named, so a MOVE can be noticed.
   *
   * A discard leaves the base where it is; a publish makes a commit and moves it.
   * That is the only signal available for telling "someone deleted this" from
   * "someone published this", and they need opposite handling: a discarded
   * patch's effect must come out of source, a published one's must stay because
   * it is in the base now.
   */
  private lastBaseSha: string | null = null;
  /**
   * Patches this client has published, which `appliedAt` cannot tell us.
   *
   * `appliedAt` comes from the server and is only ever seen on a record FETCHED
   * after its commit. A record this client created keeps `appliedAt: undefined`
   * forever, and in `http` mode a published patch stays in the chain — so a
   * shipped file went on being served from `?patch_id=...` until a reload.
   *
   * A separate set rather than a synthesised `appliedAt`, because the publish
   * seam does not return a commit sha and inventing one would put a lie in a
   * field other code reads.
   */
  private publishedIds = new Set<PatchId>();
  /**
   * Modules whose base this session moved by publishing into it.
   *
   * The question it answers is "where might the editor know something a fresh
   * server render does not". A published module is exactly that: its value is on
   * disk, but a page rendered from a server that has not picked the file up yet
   * shows the content from before — and there is no pending patch left to relay,
   * so nothing corrects it. See {@link publishedModules}.
   *
   * Recorded here rather than derived from {@link publishedIds}, because by the
   * time anyone asks, `forgetPublished` has deleted the records those ids would
   * have been looked up in.
   */
  private publishedModuleFilePaths = new Set<ModuleFilePath>();
  /**
   * Bumped whenever the chain or its data changes.
   *
   * A monotonic counter rather than a hash, for the same reason the module
   * revision is one: the only question it answers is "is what I built still
   * current", and that needs one `===`, not a walk.
   */
  private version = 0;

  /**
   * Where the parent of the next write comes from.
   *
   * Set by `createSystem`, because `PatchSync` owns the answer and is built
   * after this store. Only the file upload needs it, and it needs it badly —
   * see {@link UploadFile}.
   */
  private parentRefSource: () => ParentRef | null = () => null;

  /** See {@link parentRefSource}. */
  /** See {@link publishInFlight}. */
  setPublishInFlight(isPublishing: () => boolean): void {
    this.publishInFlight = isPublishing;
  }

  setParentRefSource(source: () => ParentRef | null): void {
    this.parentRefSource = source;
  }

  constructor(
    private readonly fetchPatches: FetchPatches,
    private readonly newPatchId: CreatePatchId = () =>
      crypto.randomUUID() as PatchId,
    private readonly activity: ActivitySink = noopActivity,
    /**
     * Absent means this store cannot accept a patch carrying files at all —
     * which is the honest default, because silently dropping the bytes is the
     * failure mode this whole seam exists to prevent.
     */
    private readonly uploadFile?: UploadFile,
  ) {}

  /**
   * Wiring is explicit and lives here rather than in a central switchboard, so
   * "what does this store react to" is answerable by reading this one method.
   */
  listenTo(stat: StatStore, source: SourceStore): () => void {
    const offStat = stat.events.on("stat:receive", (event) => {
      const baseSha = stat.currentBaseSha();
      const baseMoved =
        this.lastBaseSha !== null &&
        baseSha !== null &&
        baseSha !== this.lastBaseSha;
      if (baseSha !== null) {
        this.lastBaseSha = baseSha;
      }
      void this.onStatPatchIds(event.patches, baseMoved);
    });
    const offApply = source.events.on("source:patch-apply", (event) => {
      for (const patchId of event.success) {
        this.appliedIds.add(patchId);
        this.failedById.delete(patchId);
      }
      for (const failure of event.failed) {
        this.failedById.set(failure.patchId, failure.message);
        this.appliedIds.delete(failure.patchId);
      }
      /*
       * Held: decided, and deliberately not in source.
       *
       * Tracked so {@link chainSettled} can tell "we are still working on this"
       * from "we are finished with it and it is not in the view". Without it a
       * patch outside the reader's group is never accounted for, the chain
       * never settles, and the editor holds every field inert for the life of
       * the tab.
       *
       * It is NOT applied, so it does not join `appliedIds` — a reader asking
       * "is this patch's effect in the value" must still be told no.
       */
      for (const patchId of event.held) {
        this.heldIds.add(patchId);
        this.failedById.delete(patchId);
        this.appliedIds.delete(patchId);
      }
      for (const patchId of [
        ...event.success,
        ...event.failed.map((f) => f.patchId),
      ]) {
        // Re-staged, or now applying: it is no longer held.
        this.heldIds.delete(patchId);
      }
      this.events.emit({ type: "patch:head", head: this.currentHead() });
    });
    return () => {
      offStat();
      offApply();
    };
  }

  /**
   * Stat announced the authoritative ordered id list. Anything in it we have no
   * data for gets fetched; the head is `partial` until that lands.
   *
   * The list is adopted wholesale rather than appended to, because stat is the
   * authority on order — another session's patch can land between two of ours.
   *
   * ## Stat is the authority on ORDER, not on existence
   *
   * What stat does not name is suspect, not gone, and the difference is an edit.
   * A stat response describes the server as it was when the REQUEST was issued:
   * one issued before our `PUT /patches` landed omits a patch that exists, and a
   * response that overtakes an older one omits whatever arrived in between.
   * Removing a patch on that evidence reverts something the user typed and the
   * server has.
   *
   * So the tail stat did not name is KEPT, in place, and the question is asked
   * properly — see {@link reconcileVanished}. In place rather than
   * removed-and-restored, because a patch that turns out to exist must not have
   * its value flicker out of source and back.
   */
  /**
   * Whether a stat has ever arrived.
   *
   * Distinct from "the chain is empty": before the first stat this client does
   * not know whether there are pending changes at all, and a field rendered then
   * may be about to move. See {@link chainSettled}.
   */
  private statSeen = false;

  private async onStatPatchIds(
    patchIds: PatchId[],
    baseMoved = false,
  ): Promise<void> {
    /**
     * The FIRST stat is always news, whatever it announces.
     *
     * `chainSettled()` is false until a stat has arrived, and the editor holds
     * its fields inert until it is true — so a first stat announcing an empty
     * chain, against an empty local chain, moves nothing in `ordered` and still
     * has to be told. Without this the common case (a clean project, no pending
     * changes) leaves every field dimmed forever.
     */
    const firstStat = !this.statSeen;
    this.statSeen = true;
    /**
     * A stat older than our own publish is not evidence of anything.
     *
     * `/stat` long polls in `fs` mode: the patch list comes out of a read taken
     * when the poll OPENED, and the response is sent when a file changes — which
     * for a publish is the change the publish itself made. So the answer that
     * arrives right after `/save` routinely names the patches `/save` has just
     * committed and deleted, a whole polling interval after they stopped
     * existing. Auto-save makes that the common case rather than a rarity: it
     * publishes on every pause in typing.
     *
     * Taken at face value those ids go back into the chain — moving the head,
     * unsettling it — and are then fetched from a server that correctly no longer
     * has them, which is reported as unpublished changes that could not be
     * loaded. Nothing is wrong: they are published, and their effect is in the
     * base.
     *
     * {@link publishedIds} is what makes that recognisable, and it is why
     * {@link forgetPublished} leaves the id in it. In `http` mode a published
     * patch stays in the chain with its record, so the `dataById` test keeps this
     * to the case it is about: an id this client published AND has forgotten.
     */
    const stale = new Set(
      patchIds.filter(
        (patchId) =>
          this.publishedIds.has(patchId) && !this.dataById.has(patchId),
      ),
    );
    if (stale.size > 0) {
      console.debug(
        "Val: ignoring published changes named by a stat that predates the " +
          "publish.",
        { patchIds: [...stale] },
      );
    }
    /** What stat named, minus what it is too old to know about. */
    const named =
      stale.size > 0
        ? patchIds.filter((patchId) => !stale.has(patchId))
        : patchIds;
    const announced = new Set(named);
    for (const patchId of named) {
      if (!this.originById.has(patchId)) {
        this.originById.set(patchId, "external");
      }
    }
    const tail = this.ordered.filter((patchId) => !announced.has(patchId));
    const next = [...named, ...tail];
    /**
     * A stat that announced the chain we already hold is not news.
     *
     * `/stat` in `fs` mode long polls on a watcher over `.val/patches`, so it
     * answers on every write and again on every polling interval — and the
     * answer is usually the chain this client already has. Adopting it and
     * bumping regardless made `patch:chain` a project-wide render pulse on a
     * timer: `filePatchIds()` rebuilds and hands every media field a new map,
     * every `useChainVersion` reader re-renders and walks the chain, and the
     * pending-module validation pass is rescheduled — all for no change.
     *
     * So the bump goes where the mutation is, which is the rule
     * `SourceStore.bump` already follows. `patch:head` is emitted on the same
     * condition, because the head is a fact about the chain and the chain did
     * not move.
     */
    const moved = firstStat || !sameOrder(this.ordered, next);
    this.ordered = next;
    if (moved) {
      this.bump();
    }

    /**
     * A patch still in flight cannot be in stat, so it is not evidence of
     * anything and is not worth a round trip. Everything else in the tail is:
     * either the server has it and stat was stale, or it has been deleted and
     * this chain is showing an edit that no longer exists anywhere.
     */
    void this.reconcileVanished(
      tail.filter((patchId) => !this.pendingIds.has(patchId)),
      baseMoved,
    );

    const missing = named.filter(
      (patchId) => !this.dataById.has(patchId) && !this.fetching.has(patchId),
    );
    if (moved) {
      this.events.emit({ type: "patch:head", head: this.currentHead() });
    }
    if (missing.length === 0) {
      return;
    }
    for (const patchId of missing) {
      this.fetching.add(patchId);
    }
    // One record per ROUND TRIP, with the batch size, not one per id: the cost
    // being watched here is the request, and a test asserting "one fetch, five
    // ids" would be unable to tell that from five fetches otherwise.
    this.activity.work("patch:fetch", undefined, missing.length);
    const res = await this.fetchPatches(missing);
    if (res.error !== undefined) {
      this.events.emit({
        type: "patch:fetch-failed",
        patches: missing,
        message: res.error,
      });
    }
    if (
      res.patchGroups !== undefined &&
      !sameGroups(this.patchGroups, res.patchGroups)
    ) {
      /*
       * Bumped here, not left to the record loop below.
       *
       * The loop bumps once per DELIVERED record, so a response that carries
       * groups and no usable records — every id errored, or answered with
       * silence — moved the groups and told nobody. Compared before storing so
       * an unchanged annotation, which is what most fetches carry, does not
       * repaint the review screen.
       */
      this.patchGroups = res.patchGroups;
      this.patchGroupsSeen = true;
      this.bumpGroups();
    }
    const received: PatchId[] = [];
    for (const record of res.patches) {
      this.fetching.delete(record.patchId);
      this.notDeliveredOnce.delete(record.patchId);
      this.dataById.set(record.patchId, record);
      received.push(record.patchId);
      this.bump();
    }
    for (const [patchId, message] of Object.entries(res.errors ?? {})) {
      this.fetching.delete(patchId as PatchId);
      // An error is a definite answer, so the wait-and-confirm round that a
      // silence gets does not apply: this is reported by `patch:fetch-failed`
      // and the id is settled.
      this.notDeliveredOnce.delete(patchId as PatchId);
      this.failedById.set(patchId as PatchId, message);
    }
    /*
     * Asked for, and answered with neither a record nor an error.
     *
     * `fetching` is what stops a second request going out for an id already in
     * flight, so leaving one in it after the request has returned does not mean
     * "try again later" - it means never again. That is how a server that
     * announced 410 changes and sent 359 turned into a studio that waited on the
     * other 51 forever: no retry, because they still counted as in flight, and
     * no error, because a 200 that omits an id raises nothing.
     *
     * Stat announced these, so their absence is the server contradicting itself
     * and is recorded as a failure. Absence is NOT a failure everywhere - for an
     * id stat did not announce it is how a deleted patch is observed, which is
     * why `reconcileVanished` treats the same silence as "gone" and drops it.
     * The two differ only in whether the id was announced, and each is right for
     * its own case.
     */
    const notDelivered: PatchId[] = [];
    const inconclusive: PatchId[] = [];
    for (const patchId of missing) {
      if (
        this.fetching.delete(patchId) &&
        !this.dataById.has(patchId) &&
        // Re-read after the await rather than trusted from before it: a newer
        // stat may have stopped naming this id while the request was in flight,
        // and a patch someone else deleted mid-request is gone, not missing.
        this.ordered.includes(patchId)
      ) {
        /*
         * One empty answer is not a contradiction yet. See
         * {@link notDeliveredOnce}: the announcement may simply be older than a
         * delete — a publish or a discard, here or in another session — and the
         * id is out of `fetching` now, so the next stat that still names it
         * re-requests it. Only that answer is evidence.
         *
         * The cost of waiting is a report one stat later for a server that
         * really is announcing what it cannot send; the chain stays unsettled in
         * the meantime, so nothing on screen claims to be current. The cost of
         * not waiting is a sticky error toast every time someone publishes.
         */
        if (!this.notDeliveredOnce.has(patchId)) {
          this.notDeliveredOnce.add(patchId);
          inconclusive.push(patchId);
          continue;
        }
        this.failedById.set(
          patchId,
          "The server said this change exists, but did not send it.",
        );
        notDelivered.push(patchId);
      }
    }
    if (inconclusive.length > 0) {
      console.warn(
        "Val: the server named these unpublished changes and did not send " +
          "them. Asking again on the next stat before reporting it — an " +
          "announcement can be older than a delete.",
        { patchIds: inconclusive },
      );
    }
    if (received.length > 0) {
      this.events.emit({ type: "patch:receive", patches: received });
    }
    if (notDelivered.length > 0) {
      this.events.emit({
        type: "patch:announced-not-delivered",
        patches: notDelivered,
      });
    }
  }

  /**
   * Ask the server about patches stat stopped naming, and drop the ones it does
   * not have.
   *
   * ## Why this asks instead of inferring
   *
   * This request is issued NOW — after the save that made the patch durable has
   * already returned — so its answer describes a server that has seen everything
   * this client has done. That is what makes the conclusion safe, and it is also
   * why there is no sequence number anywhere in this file: an out-of-order or
   * stale stat costs one extra round trip that answers "still there", instead of
   * needing a protocol that can date its own responses.
   *
   * ## Conservative in both directions
   *
   * An id the server reports an ERROR for is kept. "I could not read it" is not
   * "it is gone", and dropping on it would turn a transient fault into a lost
   * edit. Only an id that comes back in neither list is treated as deleted —
   * which is how both `ValOpsFS` and `ValOpsHttp` answer for an id they do not
   * hold: `fetchPatches` filters its table by the requested ids, so one it does
   * not have is simply absent from the result.
   *
   * `drop` rather than a splice out of `ordered`, because the patch's effect is
   * in source: `SourceStore` rebuilds the module from base plus the surviving
   * chain when it hears `patch:drop`. Removing the id alone would leave the
   * deleted edit on screen with nothing left in the chain to explain it.
   */
  private async reconcileVanished(
    patchIds: PatchId[],
    baseMoved: boolean,
  ): Promise<void> {
    if (this.publishInFlight()) return;
    const ask = patchIds.filter((patchId) => !this.verifying.has(patchId));
    if (ask.length === 0) return;
    for (const patchId of ask) {
      this.verifying.add(patchId);
    }
    this.activity.work("patch:verify-vanished", undefined, ask.length);
    try {
      const res = await this.fetchPatches(ask);
      if (res.error !== undefined) {
        this.events.emit({
          type: "patch:fetch-failed",
          patches: ask,
          message: res.error,
        });
      }
      const held = new Set<PatchId>();
      for (const record of res.patches) {
        held.add(record.patchId);
      }
      for (const patchId of Object.keys(res.errors ?? {})) {
        held.add(patchId as PatchId);
      }
      const gone = ask.filter(
        (patchId) =>
          !held.has(patchId) &&
          // Re-read after the await rather than trusted from before it: this
          // patch may have been dropped, or published and forgotten, while the
          // request was in flight.
          this.ordered.includes(patchId) &&
          !this.pendingIds.has(patchId),
      );
      if (gone.length > 0) {
        if (baseMoved) {
          /**
           * The base moved, so these were PUBLISHED, not discarded — by another
           * session, or by this one in a window this client did not see. Their
           * effect is in the base now, so it has to stay on screen: `drop`
           * rebuilds the module without them and every published field reverts.
           */
          this.forgetPublished(gone);
        } else {
          this.drop(gone);
        }
      }
    } finally {
      for (const patchId of ask) {
        this.verifying.delete(patchId);
      }
    }
  }

  /**
   * Create a patch locally, uploading any files it carries first.
   *
   * ## Why the order differs for adding and removing a file
   *
   * One rule produces both: **a file must exist for as long as anything
   * references it.**
   *
   * - **Adding** a file: upload, THEN record the patch. The patch is what
   *   references the file, so the bytes have to be there before it exists. Get
   *   this backwards and you get the silent failure this seam is for — the patch
   *   applies, source points at a path, and nothing is there.
   * - **Removing** a file: record the patch, THEN delete. The patch is what
   *   stops referencing it, so deleting first would leave the OLD source
   *   pointing at bytes that are already gone — and if the patch then fails to
   *   record, that is permanent.
   *
   * ## What happens when an upload fails
   *
   * The patch is not created. That is the part that matters, and it is a
   * guarantee: nothing ever references a file that is not there.
   *
   * Files already uploaded for this patch are then deleted, best effort. That is
   * garbage collection, not correctness — an orphan is unreferenced, so it is
   * wasted bytes rather than a broken state, and a rollback that itself fails
   * must not turn a recoverable error into a worse one. So a failed rollback is
   * REPORTED (`orphaned`) rather than retried or thrown: the caller can say "try
   * again" honestly, and something has to know those bytes are now garbage.
   * There is no way to make upload-then-record atomic, so the design does not
   * pretend to.
   *
   * Emitted as `patch:create` rather than `patch:receive` because its data
   * exists immediately; the source store treats the two the same except for the
   * origin it reports to listeners.
   */
  async createPatch(
    moduleFilePath: ModuleFilePath,
    patch: Patch,
    meta?: Record<string, Json>,
    /**
     * The field instance making this edit, so it can be left asleep when the
     * patch lands while every other reader of the path is woken.
     *
     * Positional and optional rather than folded into `meta`: `meta` is
     * persisted and sent to the server, and this is neither — it is meaningless
     * outside this session.
     */
    fieldId?: string,
    /**
     * Where upload progress goes, if the caller is showing it.
     *
     * Threaded through rather than left to the caller to reconstruct: the store is
     * the only thing that knows how many files this patch carries and which one is
     * in flight, and a caller that had to work that out would be re-deriving the
     * split this store already did.
     */
    onProgress?: UploadProgress,
    /**
     * Use THIS id rather than minting one.
     *
     * For a caller that has already committed to an id — it has told something
     * else about it, or applied the patch optimistically somewhere that needs the
     * same identity. Without it, such a caller has to await this call before it
     * can act, and awaiting is exactly what it cannot do: a keystroke that waits
     * for a network-shaped operation before the character appears is a keystroke
     * the user feels.
     *
     * The caller owns uniqueness when it passes one. Reusing an existing id is
     * not checked for, because the only honest response would be to refuse a
     * patch the caller believes it has already made.
     */
    withPatchId?: PatchId,
    /**
     * The editing session this patch belongs to — an AI session, today.
     *
     * Per patch rather than per system, because a session starts and ends inside
     * the life of one system, and the server records it per patch.
     */
    sessionId?: string,
    /**
     * What KIND of binary the file ops carry.
     *
     * From the caller, because a `file` op does not say: it has a path, bytes
     * and a `remote` flag, and nothing distinguishing an image from a PDF. It
     * used to be derived from `remote`, which is a different question — so a
     * remote image was uploaded as a "file" and a local PDF as an "image". Only
     * `ValOpsHttp` reads it; `ValOpsFS` ignores it.
     */
    fileType: "image" | "file" = "image",
    /**
     * The bytes are ALREADY stored against this patch id. Do not upload them.
     *
     * One caller, and one reason: an image the editor attached in the AI chat
     * never passes through the browser twice. It is uploaded to the content
     * service when it is attached, and the assistant is told only an opaque key
     * — so when a tool turns that key into a patch, the SERVICE copies the bytes
     * onto the patch id (`patches/{id}/files/from-session-file`) and the client
     * never holds them.
     *
     * The `file` op such a patch carries therefore has the session key where
     * every other producer puts a base64 data URL. Uploading it anyway wrote the
     * key itself over the image, as the file's contents, on the same
     * (patch id, file path) the service had just written — so the image 404'd in
     * the Studio and a publish committed a UUID in place of a PNG. That is what
     * this flag prevents.
     *
     * Deletes are unaffected: a `file` op with a null value still runs, because
     * "the bytes are already there" says nothing about removing them.
     */
    filesAlreadyUploaded: boolean = false,
  ): Promise<CreatePatchResult> {
    const patchId = withPatchId ?? this.newPatchId();
    // Read once, so every file in this patch — and any rollback of them — lands
    // in the same place.
    const parentRef = this.parentRefSource();
    const { patchOps, fileOps } = splitPatchFileOps(patch);
    const toUpload = filesAlreadyUploaded
      ? []
      : fileOps.filter(
          (op): op is typeof op & { value: string } =>
            typeof op.value === "string",
        );
    const toDelete = fileOps.filter((op) => op.value === null);
    if ((toUpload.length > 0 || toDelete.length > 0) && !this.uploadFile) {
      return {
        status: "upload-failed",
        message:
          "This patch carries files, but no upload seam is configured. Refusing rather than dropping the bytes.",
        rolledBack: [],
        orphaned: [],
      };
    }
    const upload = this.uploadFile;

    const uploaded: { filePath: string; remote: boolean }[] = [];
    if (upload) {
      for (const op of toUpload) {
        this.activity.work("patch:upload-file", op.filePath);
        const fileIndex = uploaded.length;
        const res = await upload({
          patchId,
          parentRef,
          filePath: op.filePath,
          data: op.value,
          type: fileType,
          remote: op.remote,
          metadata: op.metadata,
          onProgress:
            onProgress === undefined
              ? undefined
              : (bytesUploaded, totalBytes) =>
                  onProgress(
                    bytesUploaded,
                    totalBytes,
                    fileIndex,
                    toUpload.length,
                  ),
        });
        if (res.status === "error") {
          // Roll back what did land, then refuse. No patch is created, so
          // nothing references anything missing.
          const rolledBack: string[] = [];
          const orphaned: string[] = [];
          for (const done of uploaded) {
            this.activity.work("patch:rollback-file", done.filePath);
            const undo = await upload({
              patchId,
              parentRef,
              filePath: done.filePath,
              data: null,
              type: fileType,
              // The op's OWN remoteness. Hardcoding `false` handed a remote ref
              // to a seam that only splits it into a real path when told the ref
              // is remote, so the delete targeted a path nothing had written —
              // and still reported success.
              remote: done.remote,
            });
            if (undo.status === "ok") {
              rolledBack.push(done.filePath);
            } else {
              orphaned.push(done.filePath);
            }
          }
          return {
            status: "upload-failed",
            message: res.message,
            rolledBack,
            orphaned,
          };
        }
        uploaded.push({ filePath: op.filePath, remote: op.remote === true });
      }
    }

    // Stamped here rather than left to default downstream. The patch-set store
    // orders the review list by this and shows newest first, so an unstamped
    // local edit fell back to the epoch and sorted below every other change —
    // the exact outcome the comment on that fallback said must not happen.
    const record: PatchRecord = {
      patchId,
      moduleFilePath,
      // The HASHED ops, never the bytes. `splitPatchFileOps` explains why the
      // server silently produces no file if this is got wrong.
      patch: patchOps,
      meta,
      createdAt: new Date().toISOString(),
    };
    this.dataById.set(patchId, record);
    this.originById.set(patchId, "internal");
    // Pending from the instant it exists. A locally created patch has by
    // definition not reached the server, and the alternative — marking it
    // pending when a save is attempted — leaves a window in which an edit is
    // real, unsaved, and indistinguishable from a saved one.
    this.pendingIds.add(patchId);
    if (fieldId !== undefined) {
      this.creatorByPatchId.set(patchId, fieldId);
    }
    if (sessionId !== undefined) {
      this.sessionByPatchId.set(patchId, sessionId);
    }
    this.ordered = [...this.ordered, patchId];
    this.bump();
    this.activity.work("patch:create", patchId);
    this.events.emit({ type: "patch:create", patches: [patchId] });

    // Deletes run only now that the patch that stops referencing these files
    // has landed. A failure here leaves an orphan, which is wasted bytes; doing
    // it earlier could leave the old source pointing at bytes already gone.
    if (upload) {
      for (const op of toDelete) {
        this.activity.work("patch:delete-file", op.filePath);
        await upload({
          patchId,
          parentRef,
          filePath: op.filePath,
          data: null,
          type: fileType,
          remote: op.remote,
        });
      }
    }
    return { status: "created", record };
  }

  /**
   * Locally created patches the server has not acknowledged, in chain order.
   *
   * Order matters and is not incidental: the server keeps ONE linear chain and
   * checks the `parentRef` of every write, so patches sent out of order are
   * rejected as conflicts. `this.ordered` is already the authority on order, so
   * this filters it rather than keeping a second list that could disagree with
   * it.
   */
  unsavedRecords(): PatchRecord[] {
    const records: PatchRecord[] = [];
    for (const patchId of this.ordered) {
      if (!this.pendingIds.has(patchId)) continue;
      const record = this.dataById.get(patchId);
      if (record) records.push(record);
    }
    return records;
  }

  /**
   * An id for a patch that does not exist yet.
   *
   * So a caller can commit to an identity before the async work of creating the
   * patch — see `withPatchId` on {@link createPatch}. Minting one and never using
   * it costs nothing: ids are not registered until a patch is.
   */
  mintPatchId(): PatchId {
    return this.newPatchId();
  }

  /** Which editing session made this patch, if one said. */
  sessionOf(patchId: PatchId): string | undefined {
    return this.sessionByPatchId.get(patchId);
  }

  /** Does this patch exist only here? */
  isPending(patchId: PatchId): boolean {
    return this.pendingIds.has(patchId);
  }

  /** Everything still local-only. For a "you have unsaved changes" reader. */
  pendingPatchIds(): PatchId[] {
    return this.ordered.filter((patchId) => this.pendingIds.has(patchId));
  }

  /**
   * The server has these. They are no longer local-only.
   *
   * Takes the ids the SERVER named rather than the ids we sent: a partial accept
   * is a shape the response can express, and assuming our list was accepted
   * whole would silently mark an unsaved patch saved — the one bookkeeping error
   * here that loses an edit without any error appearing anywhere.
   */
  /**
   * These have shipped. See {@link publishedIds}.
   *
   * Called on a successful publish in BOTH modes: in `fs` the patches are
   * forgotten immediately afterwards and this is redundant, in `http` they stay
   * in the chain and this is the only thing that knows.
   */
  markPublished(patchIds: readonly PatchId[]): void {
    let changed = false;
    for (const patchId of patchIds) {
      if (this.publishedIds.has(patchId)) continue;
      this.publishedIds.add(patchId);
      changed = true;
    }
    if (changed) this.bump();
    if (this.ownPatchGroupId !== undefined) {
      /*
       * A publish CLOSES the group, and the content API refuses a write or a
       * stage into a closed one. So the remembered id is not merely stale after
       * this, it is actively wrong: keeping it would answer every stage with a
       * 409 until something re-fetched the annotation.
       *
       * Forgotten rather than replaced, because there is nothing to replace it
       * with yet — the next write creates the next group and the save response
       * names it, exactly as the first one did.
       */
      this.ownPatchGroupId = undefined;
      this.bumpGroups();
    }
  }

  /**
   * The ids this session published, which no record's `appliedAt` will show.
   *
   * The other half of "has this shipped?" — see {@link publishedIds}. A reader
   * that asks only the server's answer misses everything published in the current
   * session until a refetch delivers it, which is the window in which the review
   * UI would still be offering to discard a patch that is already in a commit.
   * {@link filePatchIds} applies the same union internally.
   */
  publishedPatchIds(): ReadonlySet<PatchId> {
    return this.publishedIds;
  }

  /**
   * Modules this session has published into, in no particular order.
   *
   * For the canvas and the overlay: a page that renders one of these from the
   * server can be showing the content from before the publish, and the chain has
   * nothing left to say about it. The editor's live source does — it is the
   * published value — so it is relayed alongside the pending ones.
   *
   * Never emptied within a session. The set is bounded by the modules someone
   * edited, and re-sending a value the page already has costs one message and
   * changes nothing on screen; forgetting one too early is a stale canvas with
   * no way back.
   *
   * `http` mode never reaches this: a published patch stays in the chain there,
   * so `allRecords()` already names its module.
   */
  publishedModules(): ModuleFilePath[] {
    return [...this.publishedModuleFilePaths];
  }

  markSaved(patchIds: readonly PatchId[]): void {
    const saved: PatchId[] = [];
    for (const patchId of patchIds) {
      if (!this.pendingIds.delete(patchId)) continue;
      saved.push(patchId);
    }
    if (saved.length === 0) return;
    this.bump();
    this.activity.work("patch:mark-saved", undefined, saved.length);
  }

  /**
   * Forget published patches: out of the chain, source untouched.
   *
   * Not {@link drop}. A dropped patch was refused and its effect must disappear;
   * a published patch's effect is now in the base and must stay. So this emits no
   * `patch:drop` — the source store is told separately, in the order that keeps
   * the displayed value still (see `SourceStore.forgetPublished`).
   */
  forgetPublished(patchIds: readonly PatchId[]): void {
    const forgotten: PatchId[] = [];
    for (const patchId of patchIds) {
      if (!this.dataById.has(patchId) && !this.ordered.includes(patchId)) {
        continue;
      }
      // Before the record goes: it is the only thing that knows which module
      // this shipped into. See `publishedModuleFilePaths`.
      const moduleFilePath = this.dataById.get(patchId)?.moduleFilePath;
      if (moduleFilePath !== undefined) {
        this.publishedModuleFilePaths.add(moduleFilePath);
      }
      this.dataById.delete(patchId);
      this.originById.delete(patchId);
      this.pendingIds.delete(patchId);
      this.appliedIds.delete(patchId);
      this.failedById.delete(patchId);
      this.creatorByPatchId.delete(patchId);
      this.sessionByPatchId.delete(patchId);
      this.fetching.delete(patchId);
      this.notDeliveredOnce.delete(patchId);
      this.publishErrorById.delete(patchId);
      // Held is a fact about a patch that EXISTS. Left behind, `heldPatchIds()`
      // keeps naming an id nothing can find, and Publish tells the reader "1
      // change is held back — stage it in Review" about a patch that is not
      // there to stage.
      this.heldIds.delete(patchId);
      forgotten.push(patchId);
    }
    if (forgotten.length === 0) return;
    const gone = new Set(forgotten);
    this.ordered = this.ordered.filter((patchId) => !gone.has(patchId));
    this.bump();
    this.activity.work("patch:forget-published", undefined, forgotten.length);
    this.events.emit({ type: "patch:head", head: this.currentHead() });
  }

  /**
   * Remove patches from the chain entirely.
   *
   * For a patch the server refused PERMANENTLY (400): it cannot be retried and
   * it cannot be left in place, because the local source shows an edit that will
   * never exist anywhere else. Dropping it and rebuilding is the only outcome
   * that leaves the user looking at something true.
   *
   * Not a general undo. It emits `patch:drop` with the affected modules, and
   * {@link SourceStore} rebuilds those from base + the surviving chain — because
   * an already-applied patch cannot be un-applied, only recomputed without.
   */
  drop(patchIds: readonly PatchId[]): void {
    const dropped: PatchId[] = [];
    const modules = new Set<ModuleFilePath>();
    for (const patchId of patchIds) {
      const record = this.dataById.get(patchId);
      if (record === undefined && !this.ordered.includes(patchId)) continue;
      if (record !== undefined) {
        modules.add(record.moduleFilePath);
      }
      this.dataById.delete(patchId);
      this.originById.delete(patchId);
      this.pendingIds.delete(patchId);
      this.appliedIds.delete(patchId);
      this.failedById.delete(patchId);
      this.creatorByPatchId.delete(patchId);
      this.sessionByPatchId.delete(patchId);
      this.fetching.delete(patchId);
      this.notDeliveredOnce.delete(patchId);
      this.publishErrorById.delete(patchId);
      // Held is a fact about a patch that EXISTS. Left behind, `heldPatchIds()`
      // keeps naming an id nothing can find, and Publish tells the reader "1
      // change is held back — stage it in Review" about a patch that is not
      // there to stage.
      this.heldIds.delete(patchId);
      this.publishedIds.delete(patchId);
      dropped.push(patchId);
    }
    if (dropped.length === 0) return;
    const droppedSet = new Set(dropped);
    this.ordered = this.ordered.filter((patchId) => !droppedSet.has(patchId));
    this.bump();
    this.activity.work("patch:drop", undefined, dropped.length);
    this.events.emit({
      type: "patch:drop",
      patches: dropped,
      modules: [...modules],
    });
    // The head may have been the dropped patch. Announced after the drop so a
    // consumer reading `currentHead()` on this event sees the chain as it now
    // is, not as it was.
    this.events.emit({ type: "patch:head", head: this.currentHead() });
  }

  /**
   * Async because this is the boundary a worker would sit behind: everything a
   * field calls has to be a promise from day one, or moving the stores into a
   * worker later means rewriting every caller.
   */
  async getHead(): Promise<Head> {
    return this.currentHead();
  }

  /** In chain order, only those whose data is known. */
  recordsFor(patchIds: readonly PatchId[]): PatchRecord[] {
    const wanted = new Set(patchIds);
    const records: PatchRecord[] = [];
    for (const patchId of this.ordered) {
      if (!wanted.has(patchId)) continue;
      const record = this.dataById.get(patchId);
      if (record) records.push(record);
    }
    return records;
  }

  /**
   * The whole chain, in order, for the records whose data is known.
   *
   * Exists so patch sets can be built from the chain ON DEMAND instead of being
   * accumulated on every keystroke. The patch store is already the authority on
   * order and already holds every record, so a second incremental copy of that
   * fact was bookkeeping nobody had asked for.
   */
  /**
   * The patch groups on this branch, or `undefined` where there are none.
   *
   * The distinction is the whole contract: `undefined` means this deployment
   * has no groups and staging must stay off; an empty array means groups exist
   * and this branch's hold nothing. Reading the second as the first turns
   * staging off where it should be on; the reverse turns it on with everything
   * held.
   */
  groups(): PatchGroupT[] | undefined {
    return this.patchGroups;
  }

  /**
   * The id of the group this client's own writes join, where one is known.
   *
   * See {@link ownPatchGroupId}. Reported separately from {@link groups} because
   * it carries no membership — it says which group to stage INTO, not what is
   * in it.
   */
  ownGroupId(): string | undefined {
    return this.ownPatchGroupId;
  }

  /**
   * The server put our writes in this group. Called from the save path.
   *
   * Idempotent: the same id arrives with every save, and re-announcing it must
   * not repaint anything.
   */
  recordOwnPatchGroup(patchGroupId: string): void {
    if (this.ownPatchGroupId === patchGroupId) {
      return;
    }
    this.ownPatchGroupId = patchGroupId;
    this.patchGroupsSeen = true;
    this.bumpGroups();
  }

  /**
   * Whether this deployment has patch groups. See {@link patchGroupsSeen}.
   *
   * Never goes back to false, so a publish — which closes the group and clears
   * the remembered id — does not turn staging off.
   */
  patchGroupsSupported(): boolean {
    return this.patchGroupsSeen;
  }

  /**
   * Patches the source store is deliberately NOT applying, because they are
   * outside this reader's group.
   *
   * Reported because held is invisible in the value and yet is not absence. A
   * reader that only compares the displayed source against base sees a module
   * whose one pending patch is held as IDENTICAL to one whose pending patch was
   * undone — and calling a held change "reverted" tells its author their work
   * is gone and offers to discard it.
   */
  heldPatchIds(): ReadonlySet<PatchId> {
    return this.heldIds;
  }

  /**
   * Something about groups that this store does not hold has changed.
   *
   * The local SCOPE — which patches this client is showing and will publish —
   * lives in `createSystem`, deliberately: two stores need the same answer and
   * neither owns it. But it is group state, and a reader watching
   * `patch:groups` for "has anything about groups moved" has to be woken by it
   * too, or a stage moves the scope and every count derived from it stays
   * where it was.
   */
  notifyGroupsChanged(): void {
    this.bumpGroups();
  }

  /** Changes whenever the groups do. See the `patch:groups` event. */
  groupsVersion(): number {
    return this.groupsVersionCounter;
  }

  allRecords(): PatchRecord[] {
    return this.recordsFor(this.ordered);
  }

  /** Changes whenever the chain does, so a lazy consumer can tell if it is stale. */
  chainVersion(): number {
    return this.version;
  }

  /**
   * Patches `/save` refused, and why.
   *
   * Kept because a refusal never resolves itself. The client applies patches to
   * evaluated JSON with JSONOps; the server applies them to the `.val.ts` AST,
   * and the two can genuinely disagree — a `c.image` metadata key that is not
   * literally present, a non-literal initializer, an array shorter in the source
   * than in the evaluated JSON. So a patch that applies perfectly here can be
   * rejected there, and the publish gate has to be able to say so rather than
   * letting the user click again forever.
   *
   * Cleared for a patch that leaves the chain, and only then: a failed patch is
   * still in the chain and still shown, so forgetting the reason would leave the
   * publish button disabled with nothing explaining it.
   */
  private publishErrorById = new Map<PatchId, string>();

  /** The last {@link publishErrors} answer, reused when a fresh one is equal. */
  private publishErrorsAt: {
    n: number;
    byModule: Record<ModuleFilePath, Record<PatchId, PatchErrorEntry>>;
  } | null = null;

  recordPublishErrors(errors: Readonly<Record<PatchId, string>>): void {
    const entries = Object.entries(errors);
    if (entries.length === 0) {
      /*
       * Recording nothing is not a movement of the chain.
       *
       * A 400 that blames no particular patch — "Failed to save files", a
       * module that could not be formatted — arrives here as `{}`. Bumping for
       * it woke every chain reader for a change that had not happened, and
       * auto-save is memoised on exactly that: the batch got a new identity, the
       * debounce re-ran, the same save failed the same way, once every 700 ms
       * with nobody typing.
       */
      return;
    }
    for (const [patchId, message] of entries) {
      this.publishErrorById.set(patchId as PatchId, message);
    }
    this.bump();
  }

  /**
   * The refusals, grouped by module and then by patch.
   *
   * Grouped this way because that is how they are SHOWN: the review UI lists
   * patch sets, a patch set belongs to a module, and the card for it wants every
   * refusal in that module. A flat map keyed by patch id would make every card
   * walk the whole map.
   *
   * `source: "server"` on every entry, and it is not decoration. The client
   * applies patches to evaluated JSON with JSONOps while `/save` applies them to
   * the `.val.ts` AST, so the two can disagree — and a UI showing a refusal has
   * to be able to say which side refused, because only one of them is something
   * the user can act on locally.
   */
  publishErrors(): Record<ModuleFilePath, Record<PatchId, PatchErrorEntry>> {
    const cached = this.publishErrorsAt;
    if (cached !== null && cached.n === this.version) {
      return cached.byModule;
    }
    const byModule: Record<
      ModuleFilePath,
      Record<PatchId, PatchErrorEntry>
    > = {};
    for (const [patchId, message] of this.publishErrorById) {
      const record = this.dataById.get(patchId);
      if (record === undefined) continue;
      const forModule = byModule[record.moduleFilePath] ?? {};
      forModule[patchId] = { message, source: "server" };
      byModule[record.moduleFilePath] = forModule;
    }
    this.publishErrorsAt = { n: this.version, byModule };
    return byModule;
  }

  /**
   * The chain changed. THE single place the version moves, and the only place
   * `patch:chain` is emitted — see that event in `types.ts` for why it is not
   * the union of the five specific ones.
   */
  private bump(): void {
    this.version++;
    this.events.emit({ type: "patch:chain", version: this.version });
  }

  /**
   * The groups changed. The single place `groupsVersionCounter` moves, and the
   * only place `patch:groups` is emitted.
   */
  private bumpGroups(): void {
    this.groupsVersionCounter++;
    this.events.emit({
      type: "patch:groups",
      version: this.groupsVersionCounter,
    });
  }

  originOf(patchId: PatchId): PatchOrigin {
    return this.originById.get(patchId) ?? "external";
  }

  /**
   * The synchronous read, for other stores only. They share this realm — see
   * {@link StoreBus} — so making them await would buy nothing and would make
   * the apply/emit ordering in {@link SourceStore} impossible to guarantee.
   */
  /**
   * Whether every patch the server has announced is loaded and applied.
   *
   * False before the first stat, and false while any announced patch's ops are
   * still on their way. A patch that FAILED counts as settled: its effect is
   * never going to arrive, and something else is already telling the user about
   * it — waiting on it would mean waiting forever.
   *
   * What this is for: an editor must not be shown published content in an
   * editable field while the pending change to it is still in flight. Typing
   * over what looks like a stale value produces a "fix" for something that was
   * never wrong, and the patch lands underneath it a moment later.
   */
  chainSettled(): boolean {
    if (!this.statSeen) return false;
    for (const patchId of this.ordered) {
      if (this.failedById.has(patchId)) continue;
      if (!this.dataById.has(patchId)) return false;
      if (
        !this.appliedIds.has(patchId) &&
        !this.pendingIds.has(patchId) &&
        // Held is an answer, not a wait. See `heldIds`.
        !this.heldIds.has(patchId)
      ) {
        return false;
      }
    }
    return true;
  }

  /**
   * Why {@link chainSettled} is still false, in the words a report needs.
   *
   * There is no bound on how long the wait can be — a `GET /patches` that never
   * answers leaves the chain unsettled for as long as the tab is open, and
   * "Loading unpublished changes…" with a spinner is then a lie told forever. So
   * whatever is holding it has to be nameable: the counts say how far it got,
   * and the ids say which patches to go and look for on the server.
   *
   * `unfetched` are announced but have no ops yet — the fetch is the suspect.
   * `unapplied` arrived and the source store has not taken them, which is a
   * different fault in a different place.
   */
  chainProgress(): {
    total: number;
    settled: number;
    unfetched: PatchId[];
    unapplied: PatchId[];
    failed: PatchId[];
    /** False before the first stat: nothing has even said what to expect. */
    statSeen: boolean;
  } {
    const unfetched: PatchId[] = [];
    const unapplied: PatchId[] = [];
    const failed: PatchId[] = [];
    let settled = 0;
    for (const patchId of this.ordered) {
      if (this.failedById.has(patchId)) {
        failed.push(patchId);
        settled++;
        continue;
      }
      if (!this.dataById.has(patchId)) {
        unfetched.push(patchId);
        continue;
      }
      if (!this.appliedIds.has(patchId) && !this.pendingIds.has(patchId)) {
        unapplied.push(patchId);
        continue;
      }
      settled++;
    }
    return {
      total: this.ordered.length,
      settled,
      unfetched,
      unapplied,
      failed,
      statSeen: this.statSeen,
    };
  }

  /**
   * The last patch in the chain.
   *
   * Describes the CHAIN, and nothing reads it to decide whether a value is
   * stale — that is {@link Revision}, owned by the source store. This is for the
   * review UI, for `parentRef`, and for the `patch:head` event.
   */
  currentHead(): Head {
    if (this.ordered.length === 0) {
      return { type: "empty" };
    }
    const patchId = this.ordered[this.ordered.length - 1];
    const origin = this.originOf(patchId);
    const patch = this.dataById.get(patchId) ?? null;
    if (this.failedById.has(patchId)) {
      return { type: `${origin}-failed`, patchId, patch };
    }
    if (patch === null || !this.appliedIds.has(patchId)) {
      return { type: `${origin}-partial`, patchId, patch };
    }
    return { type: `${origin}-complete`, patchId, patch };
  }

  /**
   * Which field instance created this patch, if this session created it.
   *
   * Client-only and never persisted: attribution is only ever needed for patches
   * made here, because a patch from another tab is foreign to every local field
   * by definition. So it never has to survive a round trip — which is why it does
   * not need to be encoded into the patch id.
   */
  creatorOf(patchId: PatchId): string | undefined {
    return this.creatorByPatchId.get(patchId);
  }

  /**
   * File path -> the id of the UNPUBLISHED patch that carries its bytes.
   *
   * What a component needs to build a URL for an image the server has not
   * committed yet: `/api/val/files{path}?patch_id=...` serves the bytes out of
   * the patch directory, so without this map a just-uploaded image renders as a
   * broken link.
   *
   * ## Unpublished, not unsaved — and the difference was a bug
   *
   * This gate used to be `pendingIds`, on the reasoning that "once a patch is
   * saved the file is fetchable by its committed path". That premise is false.
   * **Saved** means `PUT /patches` succeeded: the patch is on the server, and its
   * bytes are in the PATCH directory. Only **publish** writes them to the
   * committed path. Between the two — which is the normal state of every pending
   * edit, and lasts from the moment the write lands until someone hits Save — the
   * bytes are reachable at nothing but the `patch_id` URL.
   *
   * So a gallery upload rendered correctly for the second or so before its write
   * came back, and then broke: `filePatchIds` dropped the ref, `refToUrl` fell
   * through to the published branch, and the tile pointed at a path with no file
   * behind it. Exactly the symptom the old comment predicted, caused by the gate
   * that comment was justifying.
   *
   * `appliedAt` is the honest test, and the type says why: a published patch
   * stays in the chain in `http` mode, so "is it in the chain" and "has it
   * shipped" are different questions. A patch that has shipped has its bytes at
   * the committed path and must NOT carry a `patch_id` — that one really would
   * point at a patch that may already have been collected.
   *
   * Reference-stable across an unchanged chain, because this is a
   * `useSyncExternalStore` snapshot. Memoised on {@link chainVersion} rather
   * than recomputed-and-compared: unlike the render map, two of these are not
   * comparable more cheaply than one is built.
   */
  filePatchIds(): ReadonlyMap<string, PatchId> {
    const cached = this.filePatchIdsAt;
    if (cached !== null && cached.n === this.version) {
      return cached.map;
    }
    const map = new Map<string, PatchId>();
    for (const patchId of this.ordered) {
      const record = this.dataById.get(patchId);
      if (record === undefined) continue;
      // Shipped: the bytes are at the committed path now. Either the server
      // told us (`appliedAt`, on a fetched record) or we published it ourselves.
      if (record.appliedAt || this.publishedIds.has(patchId)) continue;
      for (const op of record.patch) {
        if (op.op === "file") {
          // Later wins: if two unpublished patches touch one file, the newest is
          // the one whose bytes a read should serve.
          map.set(op.filePath, patchId);
        }
      }
    }
    this.filePatchIdsAt = { n: this.version, map };
    return map;
  }

  /**
   * The chain, indexed by the source path a reader would ask about.
   *
   * Built ONCE per chain version and shared, with each path's array reused when
   * its answer has not changed. Both halves are load-bearing, and they answer
   * different costs:
   *
   * - **Built once.** `FieldPatchAuthorsSection` is mounted on every non-compact
   *   field, and it used to walk `allRecords()` itself. That made a chain
   *   movement O(fields on screen x chain length) — and `patch:chain` moves on
   *   every keystroke's patch, on every save, and (before it was fixed) on every
   *   `/stat` poll.
   * - **Reused when equal.** A field reads this through
   *   `useSyncExternalStore`, so an array rebuilt with the same contents is a
   *   new snapshot and a guaranteed re-render. Comparing means a patch created
   *   in one field wakes that field's path and nobody else's.
   *
   * Keyed at TWO granularities, because that is what callers ask at: the module
   * file path, which answers for every patch in the module, and the exact source
   * path of each op. A reader at a deeper path finds itself under its own key or
   * not at all — the same exact-match rule the walk this replaces used.
   *
   * `isPending` travels with the record because it is what a reader renders
   * (an edit that has not reached the server is shown differently) and because
   * it moves WITHOUT the chain's membership moving — `markSaved` flips it. A
   * comparison on records alone would hold the stale answer.
   */
  patchesByPath(): ReadonlyMap<string, PatchAtPath[]> {
    const cached = this.patchesByPathAt;
    if (cached !== null && cached.n === this.version) {
      return cached.byPath;
    }
    const byPath = new Map<string, PatchAtPath[]>();
    const seen = new Map<string, Set<PatchId>>();
    const add = (key: string, entry: PatchAtPath) => {
      let already = seen.get(key);
      if (already === undefined) {
        already = new Set();
        seen.set(key, already);
      }
      // One record per key, however many of its ops land on that path.
      if (already.has(entry.record.patchId)) return;
      already.add(entry.record.patchId);
      const at = byPath.get(key);
      if (at === undefined) {
        byPath.set(key, [entry]);
      } else {
        at.push(entry);
      }
    };
    for (const patchId of this.ordered) {
      const record = this.dataById.get(patchId);
      if (record === undefined) continue;
      const entry: PatchAtPath = {
        record,
        isPending: this.pendingIds.has(patchId),
      };
      add(record.moduleFilePath, entry);
      for (const op of record.patch) {
        if (op.op === "file") continue;
        add(
          Internal.joinModuleFilePathAndModulePath(
            record.moduleFilePath,
            Internal.patchPathToModulePath(op.path),
          ),
          entry,
        );
      }
    }
    const previous = cached?.byPath;
    if (previous !== undefined) {
      for (const [key, entries] of byPath) {
        const before = previous.get(key);
        if (before !== undefined && samePatchesAtPath(before, entries)) {
          byPath.set(key, before);
        }
      }
    }
    this.patchesByPathAt = { n: this.version, byPath };
    return byPath;
  }

  private patchesByPathAt: {
    n: number;
    byPath: ReadonlyMap<string, PatchAtPath[]>;
  } | null = null;

  /**
   * Does this module have an unsaved patch that THIS field instance made?
   *
   * The store-side answer to the engine's `isOptimisticFor`, and it is worth
   * being precise about what it is for. A controlled input holds its own draft
   * state and resets it from source; it must not do that while showing an edit
   * of its own that the server has not acknowledged, or the caret jumps and a
   * fast typist loses characters.
   *
   * Narrower than the engine's version in one way that matters. The engine asked
   * "is the LAST patch in the chain yours", which is false as soon as anyone —
   * another field, another tab — writes after you, even though your edit is
   * still unsaved. This asks whether you have an unsaved patch at all, which is
   * the question the input is really asking.
   *
   * Wider in one way that does not: it is per module rather than per path.
   * Two instances of one field cannot exist, and a field's own patches only ever
   * touch its own path, so per module and per path differ only for a component
   * that writes to several paths — where the answer is the same either way.
   */
  hasUnsavedFrom(moduleFilePath: ModuleFilePath, fieldId: string): boolean {
    for (const patchId of this.pendingIds) {
      if (this.creatorByPatchId.get(patchId) !== fieldId) continue;
      if (this.dataById.get(patchId)?.moduleFilePath === moduleFilePath) {
        return true;
      }
    }
    return false;
  }

  private filePatchIdsAt: {
    n: number;
    map: ReadonlyMap<string, PatchId>;
  } | null = null;
}
