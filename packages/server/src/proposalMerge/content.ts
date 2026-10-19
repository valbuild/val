import type { ModuleFilePath, PatchId } from "@valbuild/core";
import type { Files } from "./project";
import type { StoredFile, StoredPatch, ValPatchStore } from "../ValOpsMemory";

/**
 * Content (valbuild/home `content/`), as far as merging a proposal needs it,
 * and in its shape: lines of commits whose trees are files, pending changes
 * kept per line, proposals that are lines of their own with saves and staged
 * code, and builds named by the code they were made of.
 *
 * It never loads a module or reads a schema -- that is the line the design
 * draws (`docs/hosted-publishing.md` step 8.2: "Content service should not
 * need to know about patch sets"). Where Val's answer is needed, Val gives it
 * (`world.ts`): the files of a save, of a site publish and of a merge commit,
 * and which pending changes leave the site. What content checks on its own is
 * generic: the site's head is the one the answer was computed against, and the
 * changes it moves are pending.
 */

export type Commit = {
  id: string;
  line: string;
  parents: string[];
  message: string;
  files: Files;
};

/**
 * A change: content's patches table. Pending until a commit applies it, and
 * then kept, marked with that commit -- content does not delete a published
 * change. Moving one to another line re-keys it and keeps its id.
 */
export type ContentPatch = StoredPatch & {
  line: string;
  appliedIn: string | null;
  discarded: boolean;
};

export type ContentProposal = {
  /**
   * What names it for good: home's `val_proposals.name`, a hash, never shown.
   * Every reference to a proposal is by this.
   */
  id: string;
  /**
   * What people call it. Editable, and nothing depends on it: a moved
   * proposal gets one written for it (AI may write a better one), and anyone
   * may change it.
   */
  title: string;
  /** `val/p/<id>`: the line its saves are commits on. */
  line: string;
  owners: string[];
  /** The site's commit it stands on: where it was opened, or last updated to. */
  base: string;
  status: "open" | "merged";
  /** Files written as code (the assistant's `write_files`), not by a save. */
  staged: Set<string>;
  /** The build of its code, once built: named by the code it was made of. */
  build: string | null;
};

/**
 * What a merge did about code. `none`: nothing staged, so the site's build
 * stays and the content goes live on it (step 8, "a ref update"). `reused`:
 * the proposal's own build. `built`: built in the merge, because the code
 * changed after the proposal was built -- by an update, say.
 */
export type MergeBuild = "none" | "reused" | "built";

export const SITE = "main";

/**
 * A build's name: the code it is made of. Content is read at request time
 * (step 2), so a `.val.ts` whose content changed is the same build; one
 * whose schema or imports changed is not.
 */
export type BuildName = (files: Files) => string;

export function content(initial: Files, buildName: BuildName) {
  const commits = new Map<string, Commit>();
  const heads = new Map<string, string>();
  const patches: ContentPatch[] = [];
  const proposals: ContentProposal[] = [];
  const builds = new Set<string>();

  const commit = (
    line: string,
    parents: string[],
    message: string,
    files: Files,
  ) => {
    const id = `C${commits.size}`;
    commits.set(id, { id, line, parents, message, files: tidy(files) });
    heads.set(line, id);
    return id;
  };
  const firstBuild = buildName(initial);
  builds.add(firstBuild);
  let served = firstBuild;
  commit(SITE, [], "Initial commit", initial);

  const commitById = (id: string) => {
    const found = commits.get(id);
    if (!found) throw new Error(`no commit ${id}`);
    return found;
  };
  const headOf = (line: string) => {
    const id = heads.get(line);
    if (id === undefined) throw new Error(`no line ${line}`);
    return commitById(id);
  };
  const proposalById = (id: string) => {
    const found = proposals.find((proposal) => proposal.id === id);
    if (!found) throw new Error(`no proposal ${id}`);
    return found;
  };
  const openOnly = (id: string) => {
    const proposal = proposalById(id);
    if (proposal.status !== "open") {
      throw new Error(`“${proposal.title}” is ${proposal.status}`);
    }
    return proposal;
  };
  const pendingOn = (line: string) =>
    patches.filter(
      (patch) =>
        patch.line === line && patch.appliedIn === null && !patch.discarded,
    );
  const apply = (ids: PatchId[], commitId: string) => {
    for (const patch of patches) {
      if (ids.includes(patch.patchId)) patch.appliedIn = commitId;
    }
  };
  const files = new Map<string, StoredFile>();
  const open = (title: string, owners: string[], at: string) => {
    const id = `p${proposals.length + 1}`;
    const proposal: ContentProposal = {
      id,
      title,
      line: `val/p/${id}`,
      owners,
      base: at,
      status: "open",
      staged: new Set(),
      build: null,
    };
    heads.set(proposal.line, at);
    proposals.push(proposal);
    return proposal;
  };

  return {
    // --- reading -------------------------------------------------------------

    head: (line: string) => headOf(line),
    commit: commitById,
    proposal: proposalById,
    proposals: () => [...proposals],
    pending: (line: string) => pendingOn(line).map((patch) => patch.patchId),
    /** The build visitors are served. */
    served: () => served,
    builds: () => [...builds],

    /**
     * A line's pending changes, as Val reads and writes them: through
     * content. `ValOpsHttp` sends the line with every patch request; here the
     * store is bound to it.
     */
    patchStore(line: string): ValPatchStore {
      const key = (patchId: PatchId, filePath: string) =>
        `${patchId}\u0000${filePath}`;
      return {
        list: async () => pendingOn(line).map((patch) => patch.patchId),
        get: async (patchId) => {
          const found = pendingOn(line).find((p) => p.patchId === patchId);
          if (!found) return null;
          return {
            patchId: found.patchId,
            path: found.path,
            patch: found.patch,
            authorId: found.authorId,
            createdAt: found.createdAt,
            baseSha: found.baseSha,
          };
        },
        append: async (patch) => {
          if (patches.some((p) => p.patchId === patch.patchId)) {
            throw new Error(`${patch.patchId} exists`);
          }
          patches.push({ ...patch, line, appliedIn: null, discarded: false });
        },
        // Val's deletePatches: an editor discarding a change.
        delete: async (patchIds) => {
          for (const patch of pendingOn(line)) {
            if (patchIds.includes(patch.patchId)) patch.discarded = true;
          }
        },
        putFile: async (file) => {
          files.set(key(file.patchId, file.filePath), file);
        },
        getFile: async (patchId, filePath) =>
          files.get(key(patchId, filePath)) ?? null,
        deleteFile: async (patchId, filePath) => {
          files.delete(key(patchId, filePath));
        },
        filesOf: async (patchId) =>
          [...files.values()].filter((file) => file.patchId === patchId),
      };
    },

    // --- the site ---------------------------------------------------------------

    /**
     * The seal of the site's Publish: the files Val prepared, as one commit,
     * and the changes they hold are no longer pending. A build only when the
     * code changed, which a site publish never does: code changes in a
     * proposal (step 7).
     */
    sealSite(input: {
      expectedHead: string;
      files: Files;
      published: PatchId[];
    }) {
      const before = headOf(SITE);
      if (before.id !== input.expectedHead) {
        throw new Error("the site moved while this publish was prepared");
      }
      const id = commit(SITE, [before.id], "Publish", {
        ...before.files,
        ...input.files,
      });
      apply(input.published, id);
      return id;
    },

    // --- proposals ------------------------------------------------------------

    openProposal(title: string, owner: string) {
      return open(title, [owner], headOf(SITE).id).id;
    },

    /** Rename: the title only. Its id, line and everything on it stay. */
    rename(id: string, title: string) {
      proposalById(id).title = title;
    },

    /**
     * Save: the proposal's pending changes, as the files Val prepared from
     * them, become a commit on its line.
     */
    save(id: string, input: { files: Files; saved: PatchId[] }) {
      const proposal = openOnly(id);
      const before = headOf(proposal.line);
      const saved = commit(proposal.line, [before.id], "Save", {
        ...before.files,
        ...input.files,
      });
      apply(input.saved, saved);
    },

    /** The assistant's `write_files`: code, written whole, as a commit. */
    stage(id: string, files: Files) {
      const proposal = openOnly(id);
      const before = headOf(proposal.line);
      commit(proposal.line, [before.id], "Stage files", {
        ...before.files,
        ...files,
      });
      for (const path of Object.keys(files)) proposal.staged.add(path);
    },

    /** Build: the proposal's code, built in the tab and stored by its name. */
    build(id: string) {
      const proposal = openOnly(id);
      const built = buildName(headOf(proposal.line).files);
      builds.add(built);
      proposal.build = built;
      return built;
    },

    /** "Build required": staged code with no build of it. */
    buildRequired(id: string) {
      const proposal = proposalById(id);
      return (
        proposal.staged.size > 0 &&
        proposal.build !== buildName(headOf(proposal.line).files)
      );
    },

    /**
     * Update from the site: Val's merge commit `M`, with the site's head as
     * its second parent. The proposal now stands on that head.
     */
    updateFromSite(
      id: string,
      input: { siteHead: string; files: Files; staged: string[] },
    ) {
      const proposal = openOnly(id);
      if (headOf(SITE).id !== input.siteHead) {
        throw new Error("the site moved while the update was prepared");
      }
      if (pendingOn(proposal.line).length > 0) {
        throw new Error("the proposal has unsaved changes");
      }
      const before = headOf(proposal.line);
      commit(
        proposal.line,
        [before.id, input.siteHead],
        "Merge the site",
        input.files,
      );
      proposal.base = input.siteHead;
      // What it has to build now is the code it differs from the site in.
      // Code the update resolved to the site's needs no build any more.
      proposal.staged = new Set(input.staged);
    },

    /**
     * Merge: the proposal's last commit, squashed onto the site as one
     * commit. Val has already brought the proposal up to the site (`M`), so
     * the tree is the proposal's, whole. The site's pending changes Val names
     * leave the site, in groups, each into a proposal that stands on the
     * commit before the merge -- the one they were written over -- owned by
     * whoever wrote them.
     */
    merge(
      id: string,
      input: { siteHead: string; move: PatchId[][] },
    ): { before: string; after: string; moved: string[]; build: MergeBuild } {
      const proposal = openOnly(id);
      const before = headOf(SITE);
      // Generic checks: no schema, no fields.
      if (before.id !== input.siteHead || proposal.base !== before.id) {
        throw new Error("the site moved: update the proposal first");
      }
      if (pendingOn(proposal.line).length > 0) {
        throw new Error("the proposal has unsaved changes");
      }
      const pendingIds = new Set(pendingOn(SITE).map((p) => p.patchId));
      for (const id of input.move.flat()) {
        if (!pendingIds.has(id)) throw new Error(`${id} is not pending`);
      }

      const after = commit(
        SITE,
        [before.id],
        `Merge “${proposal.title}”`,
        headOf(proposal.line).files,
      );
      proposal.status = "merged";
      let build: MergeBuild = "none";
      if (proposal.staged.size > 0) {
        // Builds are named by their inputs: the proposal's own, if it is of
        // this code, and otherwise the merge builds it (in the tab).
        const code = buildName(headOf(proposal.line).files);
        build = proposal.build === code ? "reused" : "built";
        builds.add(code);
        served = code;
      }

      const moved: string[] = [];
      for (const ids of input.move) {
        const group = patches.filter(
          (patch) => patch.line === SITE && ids.includes(patch.patchId),
        );
        const owners = [
          ...new Set(group.map((patch) => patch.authorId ?? "unknown")),
        ];
        // A title to start with. Nothing depends on it; see `title`.
        const into = open(
          `Moved when “${proposal.title}” was published`,
          owners,
          before.id,
        );
        for (const patch of group) patch.line = into.line;
        moved.push(into.id);
      }
      return { before: before.id, after, moved, build };
    },

    /**
     * Where a change is now, by its row: published, pending on the site, or
     * in one open proposal (saved there, or not yet). A change pending on a
     * proposal that has been merged was left behind -- lost.
     */
    whereIs(patchId: PatchId) {
      const row = patches.find((patch) => patch.patchId === patchId);
      if (!row) return "lost: no row";
      if (row.discarded) return "discarded";
      const proposal = proposals.find((p) => p.line === row.line);
      if (row.line === SITE) {
        return row.appliedIn === null ? "pending on the site" : "published";
      }
      if (!proposal) return `lost: on ${row.line}`;
      if (proposal.status === "merged") {
        return row.appliedIn === null
          ? `lost: unsaved in ${proposal.id}, which was merged`
          : "published";
      }
      return row.appliedIn === null
        ? `in ${proposal.id}`
        : `saved in ${proposal.id}`;
    },
    allPatchIds: () => patches.map((patch) => patch.patchId),
  };
}

export type Content = ReturnType<typeof content>;

/** Deleted files are not in a tree. */
function tidy(files: Files): Files {
  return Object.fromEntries(
    Object.entries(files).filter(([, text]) => text !== null),
  );
}

export type { ModuleFilePath };
