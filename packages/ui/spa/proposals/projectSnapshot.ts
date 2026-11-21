import { proposalProject } from "@valbuild/shared/publish";
import type {
  ProposalsClient,
  ProposalStaged,
  ProposalStagedAnswer,
} from "./proposalsClient";

/**
 * The project the assistant's code tools read, HELD IN THE TAB for the life
 * of the chat: the site's source, and the files of the proposal this Studio
 * is in, laid over it.
 *
 * Before this every `read_file`, `search_code`, `list_files`, `edit_file`,
 * `format_files` and `lint` asked for both again, one after the other, each
 * through the app's relay to the content service. A model that read five
 * files paid for the whole project ten times.
 *
 * ## What "current" means
 *
 * The proposal's part is current when it was read at the project's `seq` the
 * tab holds now (`ManifestSource.seq`: it moves with every save and every
 * staging in the proposal, by anyone) and nothing this tab did since leaves
 * it in doubt. While it is current a read costs no request.
 *
 * - **This tab's own stagings are laid over it at once** (`stage`): the tab
 *   knows what it wrote, and the answer carries what is staged. So a tool
 *   call queued behind a write reads what that write wrote.
 * - **A staging that saved content first leaves it in doubt.** Val's server
 *   saves every pending content change before it stages
 *   (`beforeProposalCodeWrite`), which writes `.val.ts` files this tab did
 *   not write. The answer says whether it did (`savedFirst`); when it did,
 *   or did not say, the next read asks again.
 * - **A staging that fails leaves nothing held**: the save may have been
 *   made and the staging refused.
 * - **Any move of `seq` ends it**, this tab's own stagings included: one
 *   staging cannot be told from two by a number that only orders. So after
 *   a staging of this tab's the files are read again, started as soon as
 *   the move is heard ({@link ProjectSnapshot.seqMoved}) rather than when
 *   the model next asks, so it has usually landed by then.
 * - **A staging of this tab's vouches for what is held for
 *   {@link OWN_STAGING_GRACE_MS} after `seq` moves**, where the server said
 *   it saved nothing first. Its own move of `seq` reaches the tab before
 *   the staging's answer does, so without this every edit in one reply of
 *   the model waited for a whole re-read; with it they are one request
 *   each, and the re-read lands behind them. It does not chain: a second
 *   stretch needs a completed re-read in between.
 * - **No `seq` (no manifest yet) is never current**: every read asks, as
 *   before.
 * - **It is held for {@link FRESH_MS} at most**, however quiet `seq` is.
 *
 * ## The case that matters: `edit_file` over someone else's change
 *
 * `edit_file` writes a file's whole text, made from the text held here. If
 * someone else changed that file and this tab has not heard, their change is
 * overwritten. What stands against it:
 *
 * - their staging (or save) moves `seq`, which reaches this tab over the
 *   Studio's socket, and the held files are not used once it has;
 * - a re-read is anchored at the `seq` taken BEFORE it was asked for, so a
 *   change that lands during the read ends it too;
 * - a read that overlapped a staging of this tab's own is made again.
 *
 * What is left is the time a move of `seq` takes to arrive -- the socket's
 * delay, and {@link FRESH_MS} at most where it never does -- and, behind a
 * staging of this tab's own, {@link OWN_STAGING_GRACE_MS}. The old code had
 * a window too, between its read and its staging, and only the content
 * service can close it (a staging that names the version it was made from).
 *
 * ## The site's source
 *
 * Asked by version (`createProjectSourceReader`: a 304 while it is the
 * same), with every re-read of the proposal's files -- in parallel -- and
 * otherwise when it was last asked more than {@link FRESH_MS} ago; on
 * the site, also when `seq` moved, which a publish does. A proposal that
 * edits a file the site changed a moment ago is not a silent loss: updating
 * from the site reports it as a conflict.
 */
export type ProjectSnapshot = {
  /**
   * The project of proposal `proposal`, or the site's with `null`: from
   * what is held when that is current, read otherwise.
   */
  read(proposal: string | null): Promise<ProjectRead>;
  /**
   * Stage files in the proposal (`ProposalsClient.stageFiles`) and lay them
   * over what is held: the one way this tab's code tools write.
   */
  stage(
    proposal: string,
    files: Record<string, string | null>,
    message?: string,
  ): Promise<ProposalStagedAnswer>;
  /**
   * What is staged in `proposal` as far as this tab holds it, without
   * asking; `undefined` when nothing is held of it.
   */
  staged(proposal: string): ProposalStaged | undefined;
  /**
   * The project's `seq` moved: after a staging of this tab's, the re-read
   * starts now rather than with the next tool call.
   */
  seqMoved(): void;
};

export type ProjectRead = {
  /** Path from the project root -> text. */
  project: Record<string, string>;
  /** What the proposal stages; `null` on the site. */
  staged: ProposalStaged | null;
};

export type ProjectSnapshotDeps = {
  /** Without `stageFiles`, it only reads: {@link ProjectSnapshot.stage} throws. */
  client: Pick<ProposalsClient, "files"> &
    Partial<Pick<ProposalsClient, "stageFiles">>;
  /** The site's source, by version: `createProjectSourceReader`. */
  siteSource: () => Promise<Record<string, string> | null>;
  /** The project's `seq` as this tab holds it; `null` where there is none. */
  seq: () => number | null;
  /** For tests: the clock. */
  now?: () => number;
};

/**
 * How long what is held is used without asking again, whatever `seq` says:
 * the site's source, whose moves `seq` does not always carry, and the
 * proposal's files, so a move of `seq` that never arrives (a socket that is
 * down) is not trusted for longer than this.
 */
export const FRESH_MS = 30_000;

/**
 * How long after `seq` moved what is held is still used, when this tab
 * staged since it was read and the server saved nothing first: long enough
 * for the edits of one reply, about what the old read-then-stage took.
 */
export const OWN_STAGING_GRACE_MS = 2_000;

/** A read that overlapped this tab's own staging is made again, this often at most. */
const MAX_READS = 3;

type Held = {
  name: string;
  /** The proposal's own files, `null` for a delete. */
  own: Record<string, string | null>;
  staged: ProposalStaged;
  /** The tab's `seq` before it was read. */
  seq: number | null;
  /** This tab staged since it was read. */
  written: boolean;
  /** A staging since may have changed files this tab did not write. */
  inDoubt: boolean;
  /** When it was read. */
  at: number;
  /** When `seq` was first seen to have moved from `seq`; `null` while it has not. */
  movedAt: number | null;
};

export function createProjectSnapshot(
  deps: ProjectSnapshotDeps,
): ProjectSnapshot {
  const now = deps.now ?? Date.now;
  let held: Held | null = null;
  let reading: { name: string; done: Promise<Held> } | null = null;
  /** Moves with every staging of this tab's that ended, either way. */
  let stagings = 0;
  let site: {
    value: Record<string, string>;
    at: number;
    seq: number | null;
  } | null = null;
  let askingSite: Promise<Record<string, string>> | null = null;
  /** `proposalProject` of what is held, until either part changes. */
  let merged: {
    site: Record<string, string>;
    own: Held["own"];
    project: Record<string, string>;
  } | null = null;

  const isCurrent = (name: string): boolean => {
    if (
      held === null ||
      held.name !== name ||
      held.inDoubt ||
      held.seq === null ||
      now() - held.at >= FRESH_MS
    ) {
      return false;
    }
    if (deps.seq() === held.seq) return true;
    if (held.movedAt === null) held.movedAt = now();
    return held.written && now() - held.movedAt < OWN_STAGING_GRACE_MS;
  };

  /** Read again behind a staging of this tab's, once `seq` has moved. */
  const readAgainIfMoved = () => {
    if (held === null || !held.written) return;
    if (held.seq !== null && deps.seq() === held.seq && !held.inDoubt) return;
    if (reading !== null && reading.name === held.name) return;
    if (held.movedAt === null) held.movedAt = now();
    // Its failure is the next read's to report.
    void startReading(held.name).catch(() => undefined);
  };

  const startReading = (name: string): Promise<Held> => {
    const read = async (): Promise<Held> => {
      for (let reads = 1; ; reads++) {
        const seq = deps.seq();
        const before = stagings;
        const answer = await deps.client.files(name);
        const next: Held = {
          name,
          own: answer.files,
          staged: answer.staged,
          seq,
          written: false,
          inDoubt: false,
          at: now(),
          movedAt: null,
        };
        if (before === stagings) {
          held = next;
          return next;
        }
        // A staging of this tab's ended while this was read: the answer
        // may or may not have it.
        if (reads >= MAX_READS) return next;
      }
    };
    const done: Promise<Held> = read().finally(() => {
      if (reading !== null && reading.done === done) reading = null;
    });
    reading = { name, done };
    return done;
  };

  const readProposal = async (name: string): Promise<Held> => {
    if (held !== null && isCurrent(name)) return held;
    if (reading !== null && reading.name === name) {
      // A read under way is this call's too only if it was asked for at the
      // `seq` the tab holds now: an older one may be from before a change
      // this call has heard of.
      const seq = deps.seq();
      const joined = await reading.done;
      if (joined.seq === seq) return joined;
      if (held !== null && isCurrent(name)) return held;
    }
    if (reading !== null && reading.name === name) return reading.done;
    return startReading(name);
  };

  const readSite = (again: boolean): Promise<Record<string, string>> => {
    if (site !== null && !again && now() - site.at < FRESH_MS) {
      return Promise.resolve(site.value);
    }
    if (askingSite !== null) return askingSite;
    const ask = async (): Promise<Record<string, string>> => {
      const seq = deps.seq();
      const value = (await deps.siteSource()) ?? {};
      site = { value, at: now(), seq };
      return value;
    };
    const asking: Promise<Record<string, string>> = ask().finally(() => {
      if (askingSite === asking) askingSite = null;
    });
    askingSite = asking;
    return asking;
  };

  return {
    async read(proposal) {
      if (proposal === null) {
        const moved = site !== null && deps.seq() !== site.seq;
        return { project: await readSite(moved), staged: null };
      }
      const [siteFiles, own] = await Promise.all([
        readSite(!isCurrent(proposal)),
        readProposal(proposal),
      ]);
      if (
        merged === null ||
        merged.site !== siteFiles ||
        merged.own !== own.own
      ) {
        merged = {
          site: siteFiles,
          own: own.own,
          project: proposalProject(siteFiles, own.own),
        };
      }
      return { project: merged.project, staged: own.staged };
    },

    async stage(proposal, files, message) {
      const stageFiles = deps.client.stageFiles;
      if (stageFiles === undefined) {
        throw new Error("This reads the project's files; it stages none.");
      }
      // Whether what is held was current when this was sent: a staging
      // vouches for nothing it was not made from.
      const sentFrom = held;
      const wasCurrent = isCurrent(proposal);
      let answer: ProposalStagedAnswer;
      try {
        answer = await stageFiles(proposal, files, message);
      } catch (error) {
        stagings++;
        if (held !== null && held.name === proposal) held = null;
        throw error;
      }
      stagings++;
      if (held !== null && held.name === proposal) {
        const paths = Object.keys(files);
        held = {
          ...held,
          own: { ...held.own, ...files },
          staged: answer.staged,
          written: true,
          inDoubt:
            held.inDoubt ||
            // Unless it was read again meanwhile: that is the server's own.
            (held === sentFrom && !wasCurrent) ||
            answer.savedFirst !== false ||
            // A path the server may name differently than it was written.
            !paths.every(isPlainPath),
        };
        // Its own move of `seq` is often here before its answer.
        readAgainIfMoved();
      }
      return answer;
    },

    staged(proposal) {
      return held !== null && held.name === proposal ? held.staged : undefined;
    },

    seqMoved() {
      readAgainIfMoved();
    },
  };
}

/** A path as the content service keeps it: from the root, nothing to resolve. */
function isPlainPath(path: string): boolean {
  return (
    path !== "" &&
    !path.startsWith("/") &&
    !path.includes("\\") &&
    !path
      .split("/")
      .some((part) => part === "" || part === "." || part === "..")
  );
}
