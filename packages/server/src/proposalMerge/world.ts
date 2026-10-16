import { Internal, type ModuleFilePath, type PatchId } from "@valbuild/core";
import type { Operation } from "@valbuild/core/patch";
import { ValOpsMemory } from "../ValOpsMemory";
import type { AuthorId } from "../ValOps";
import { content, SITE, type MergeBuild } from "./content";
import {
  changesToMove,
  mergeFromSite,
  type Conflict,
  type Project,
  type Resolution,
} from "./merge";
import {
  buildName,
  loadProject,
  scaffold,
  type Files,
  type LoadedProject,
  type Page,
} from "./project";

/**
 * A site, its editors and their proposals, in the shape http mode has them:
 * the scenarios of valbuild/home `docs/hosted-publishing.md` step 8.2.
 *
 * - **Content** (`content.ts`) is modelled: lines of commits whose trees are
 *   files, the patches table per line, proposals with saves, staged code and
 *   builds, and the merge -- carried out by change id, never by schema.
 * - **Val** is real: on any line, the project at the line's head is loaded by
 *   Val's own loader (`loadValModules`, as `val validate` does) and served by
 *   the `ValOps` that `ValOpsHttp` extends, reading and writing that line's
 *   patches through content. A change is `createPatch`, a draft is
 *   `getSources`, and a save or a site publish is `prepare`, which rewrites the
 *   `.val.ts` text. So a schema a proposal stages is the schema the next
 *   load reads.
 * - **What Val decides about a merge** is `merge.ts`: the merge commit, and
 *   which pending changes leave the site.
 *
 * Not modelled, and why it does not change an answer here: content keeps each
 * module's Source in an index beside the files (`val_module_versions`), and
 * http mode reads Source from it. Every writer here writes text and Source
 * together (`prepare`), so the text is read for both.
 *
 * After every step that moves a change, content is asked where each change
 * ever written is (`whereIs`): none may be lost.
 */

export type PublishOutcome =
  | {
      status: "published";
      before: string;
      after: string;
      build: MergeBuild;
      /** The proposals the site's conflicting pending changes moved into. */
      moved: string[];
    }
  | { status: "conflicts"; conflicts: Conflict[] };

export type SitePublishOutcome =
  | { status: "published"; commit: string; ids: PatchId[] }
  | { status: "nothing-to-publish" };

export type UpdateOutcome =
  | { status: "updated"; base: string }
  | { status: "conflicts"; conflicts: Conflict[] };

export async function world(pages: Page[], code: Files = {}) {
  const initial: Files = {
    ...scaffold(pages.map((page) => page.file)),
    ...Object.fromEntries(pages.map((page) => [page.file, page.text])),
    ...Object.assign({}, ...pages.map((page) => page.files)),
    ...code,
  };
  const c = content(initial, buildName);
  const written: PatchId[] = [];
  const counters = new Map<string, number>();

  // --- Val, on a line ----------------------------------------------------------

  const loaded = new Map<string, Promise<LoadedProject>>();
  /** The project at a commit. Commits do not change, so each loads once. */
  const projectAt = async (commitId: string): Promise<Project> => {
    const files = c.commit(commitId).files;
    let project = loaded.get(commitId);
    if (!project) {
      project = loadProject(files);
      loaded.set(commitId, project);
    }
    return { files, loaded: await project };
  };
  /** Val's server on a line: its head's project, its pending changes. */
  const valOn = async (line: string) => {
    const { loaded: project } = await projectAt(c.head(line).id);
    return new ValOpsMemory(project.valModules, {
      config: project.valModules.config,
      sourceFiles: project.sourceFiles,
      patchStore: c.patchStore(line),
    });
  };
  const pendingOf = async (ops: ValOpsMemory) => {
    const pending = await ops.fetchPatches({ excludePatchOps: false });
    if ("error" in pending && pending.error) {
      throw new Error(`could not read changes: ${pending.error.message}`);
    }
    return pending;
  };
  /** A line's draft: its head, and every pending change, as Val applies them. */
  const draftOn = async (line: string) => {
    const ops = await valOn(line);
    const pending = await pendingOf(ops);
    const analysis = ops.analyzePatches(pending.patches, pending.commits);
    const committed = (await ops.getSources()).sources;
    const patched = await ops.getSources({ ...analysis, ...pending });
    // `getSources` answers for the modules with changes; the rest are as
    // committed. A `.jsonValues()` entry nobody changed is still a marker:
    // read its file, so a page reads the same whether it is pending or not.
    const sources = { ...committed, ...patched.sources };
    for (const [path, source] of Object.entries(sources)) {
      sources[path as ModuleFilePath] =
        await Internal.resolveJsonValues(source);
    }
    return { sources, errors: patched.errors };
  };
  /**
   * Val's prepare on a line: the `.val.ts` files its pending changes rewrite,
   * as a save or a site publish sends them to content.
   */
  const prepareOn = async (line: string) => {
    const ops = await valOn(line);
    const pending = await pendingOf(ops);
    const ids = pending.patches.map((patch) => patch.patchId);
    const analysis = ops.analyzePatches(pending.patches, pending.commits);
    const prepared = await ops.prepare({ ...analysis, ...pending });
    if (prepared.hasErrors) {
      throw new Error(
        `prepare failed on ${line}: ${JSON.stringify(prepared.sourceFilePatchErrors)}`,
      );
    }
    const files: Files = {};
    for (const [path, text] of Object.entries(prepared.patchedSourceFiles)) {
      files[path.replace(/^\//, "")] = text;
    }
    return { files, ids, pending: pending.patches };
  };

  /** Ids read in scenarios: "kari-1" is Kari's first change. */
  const nextId = (author: string): PatchId => {
    const n = (counters.get(author) ?? 0) + 1;
    counters.set(author, n);
    return `${author}-${n}` as PatchId;
  };
  const write = async (
    line: string,
    author: string,
    page: Page,
    patch: Operation[],
  ) => {
    const ops = await valOn(line);
    const patchId = nextId(author);
    const created = await ops.createPatch(
      page.moduleFilePath,
      patch,
      patchId,
      { type: "head", headBaseSha: await ops.getBaseSha() },
      null,
      author as AuthorId,
    );
    if (created.kind !== "ok") {
      throw new Error(`${patchId} was refused: ${JSON.stringify(created)}`);
    }
    written.push(patchId);
    return patchId;
  };

  // --- checks after every step -------------------------------------------------

  /**
   * Nothing is lost: every change ever written is published, pending on the
   * site, or in one open proposal. And every change still pending on the site
   * applies to the site's head -- one that no longer does should have moved.
   */
  const check = async () => {
    for (const id of written) {
      const where = c.whereIs(id);
      if (where.startsWith("lost")) throw new Error(`${id} was ${where}`);
    }
    const { errors } = await draftOn(SITE);
    const failing = Object.values(errors).flat();
    if (failing.length > 0) {
      throw new Error(
        `pending on the site and no longer applies: ${failing
          .map((error) => `${error.patchId} (${error.error.message})`)
          .join(", ")}`,
      );
    }
  };

  // --- what editors, the assistant and content do ---------------------------------

  const proposalHandle = (id: string) => {
    const owner = () => c.proposal(id).owners[0];
    return {
      id,
      /** A change in the proposal, pending until saved. */
      patch: (page: Page, patch: Operation[]) =>
        write(c.proposal(id).line, owner(), page, patch),
      /** Save: Val prepares the files, content commits them on the line. */
      async save() {
        const { files, ids } = await prepareOn(c.proposal(id).line);
        if (ids.length === 0) return;
        c.save(id, { files, saved: ids });
      },
      /** The assistant's `write_files`: code, staged in the proposal. */
      stage: (files: Files) => c.stage(id, files),
      /** Rename it: anyone may, and nothing depends on the title. */
      rename: (title: string) => c.rename(id, title),
      /** Build, in the tab, of the proposal's code as it is now. */
      build: () => c.build(id),
    };
  };
  type ProposalHandle = ReturnType<typeof proposalHandle>;

  /**
   * Update from the site, as Val runs it: the three projects to
   * `mergeFromSite`, and its merge commit to content.
   */
  const updateFromSite = async (
    id: string,
    resolutions: Resolution[],
  ): Promise<UpdateOutcome> => {
    const proposal = c.proposal(id);
    const site = c.head(SITE).id;
    const result = await mergeFromSite({
      base: await projectAt(proposal.base),
      site: await projectAt(site),
      proposal: await projectAt(c.head(proposal.line).id),
      resolutions,
    });
    if (result.status === "conflicts") return result;
    c.updateFromSite(id, {
      siteHead: site,
      files: result.files,
      staged: result.code,
    });
    await check();
    return { status: "updated", base: site };
  };

  return {
    /** An editor working directly on the site: every change is pending there. */
    onSite(author: string) {
      return {
        patch: (page: Page, patch: Operation[]) =>
          write(SITE, author, page, patch),
      };
    },

    openProposal(title: string, options: { by: string }): ProposalHandle {
      return proposalHandle(c.openProposal(title, options.by));
    },

    /** A proposal by id: the moved ones too (`moved` in a publish's outcome). */
    proposal(id: string): ProposalHandle {
      return proposalHandle(c.proposal(id).id);
    },

    /**
     * Publish in a proposal, as the Studio presses it (`runPublish`): its
     * unsaved changes are saved first. If the site moved since the
     * proposal's base, Val updates it -- and stops at a conflict, changing
     * nothing. Then Val names the site's pending changes the merge conflicts
     * with, and content merges: one commit on the site, those changes moved
     * out.
     */
    async publish(handle: { id: string }): Promise<PublishOutcome> {
      const id = handle.id;
      await proposalHandle(id).save();
      if (c.proposal(id).base !== c.head(SITE).id) {
        const updated = await updateFromSite(id, []);
        if (updated.status === "conflicts") return updated;
      }
      const siteHead = c.head(SITE).id;
      const ops = await valOn(SITE);
      const pending = (await pendingOf(ops)).patches;
      // Nothing pending, nothing to move: Val is not asked.
      const move =
        pending.length === 0
          ? []
          : await changesToMove({
              site: await projectAt(siteHead),
              merged: await projectAt(c.head(c.proposal(id).line).id),
              pending: pending.map((patch) => ({
                patchId: patch.patchId,
                moduleFilePath: patch.path,
                patch: patch.patch,
              })),
            });
      const merged = c.merge(id, { siteHead, move });
      await check();
      return {
        status: "published",
        before: merged.before,
        after: merged.after,
        build: merged.build,
        moved: merged.moved,
      };
    },

    /** Update from the site, with a resolution for every conflict. */
    update(handle: { id: string }, resolutions: Resolution[] = []) {
      return updateFromSite(handle.id, resolutions);
    },

    /** The site's own Publish: every pending change, through Val's prepare. */
    async publishSite(): Promise<SitePublishOutcome> {
      const { files, ids } = await prepareOn(SITE);
      if (ids.length === 0) return { status: "nothing-to-publish" };
      const commit = c.sealSite({
        expectedHead: c.head(SITE).id,
        files,
        published: ids,
      });
      await check();
      return { status: "published", commit, ids };
    },

    site: {
      /** A page as visitors see it: the site's head. */
      async page(page: Page) {
        const { loaded: project } = await projectAt(c.head(SITE).id);
        return project.modules[page.moduleFilePath]?.source;
      },
      /** A page as an editor on the site sees it: the head and every pending change. */
      async draft(page: Page) {
        return (await draftOn(SITE)).sources[page.moduleFilePath];
      },
      pending: () => c.pending(SITE),
      /** A file at the site's head, as git has it. */
      file: (file: string) => c.head(SITE).files[file] ?? null,
      /** The build visitors are served. */
      served: () => c.served(),
    },

    /** A proposal's page, as its address shows it: its head and its pending changes. */
    async proposalPage(handle: { id: string }, page: Page) {
      return (await draftOn(c.proposal(handle.id).line)).sources[
        page.moduleFilePath
      ];
    },
    /** A file in a proposal, as its line has it. */
    proposalFile(handle: { id: string }, file: string) {
      return c.head(c.proposal(handle.id).line).files[file] ?? null;
    },
    buildRequired: (handle: { id: string }) => c.buildRequired(handle.id),

    proposals() {
      return c.proposals().map((proposal) => ({
        id: proposal.id,
        title: proposal.title,
        owners: proposal.owners,
        base: proposal.base,
        changes: c.pending(proposal.line),
        status: proposal.status,
      }));
    },
    /** Where a change is: see `whereIs`. */
    whereIs: (patchId: string) => c.whereIs(patchId as PatchId),
    /** The site's head commit id. */
    siteHead: () => c.head(SITE).id,
  };
}

export type { ModuleFilePath };
