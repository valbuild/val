import {
  initVal,
  Internal,
  type ModuleFilePath,
  type PatchId,
  type ValModule,
  type ValModules,
} from "@valbuild/core";
import type { JSONValue, Operation } from "@valbuild/core/patch";
import {
  mergePlan,
  type MergeConflict,
  type PendingChange,
} from "@valbuild/shared/internal";
import { InMemoryPatchStore, ValOpsMemory } from "../ValOpsMemory";
import type { AuthorId } from "../ValOps";

/**
 * A site, its editors and their proposals: the scenarios of valbuild/home
 * `docs/hosted-publishing.md` step 8.2, played out on Val's real server code.
 *
 * Every branch -- the site, and each proposal -- is a real `ValOpsMemory`:
 * changes are written with `createPatch`, a draft is `getSources`, what is
 * pending is `fetchPatches`, and a change leaves a branch with
 * `deletePatches`. Only content's part is modelled here, with what content
 * itself does and nothing more: the commits, the list of proposals, and
 * carrying out a merge plan by change id. It never looks at a schema, which
 * is the line the design draws -- and what lets content's real handlers take
 * this part over in a second driver.
 */

/** A module, as `c.define` makes it. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Module = ValModule<any>;

/** A published version of the site: each page's content. */
type Commit = { id: string; pages: Record<ModuleFilePath, JSONValue> };

type Proposal = {
  name: string;
  owners: string[];
  /** The site commit it started from. */
  startsAt: string;
  ops: ValOpsMemory;
  status: "open" | "merged";
};

export type PublishOutcome =
  | { status: "published"; before: string; after: string; conflicts: [] }
  | { status: "conflicts"; conflicts: MergeConflict[] };

export type UpdateOutcome =
  | { status: "updated"; startsAt: string }
  | { status: "conflicts"; conflicts: MergeConflict[] };

/**
 * How a conflict is resolved when the proposal is updated from the site:
 * keep one side, or write the value (what AI or a developer would).
 */
export type Resolution = { module: Module; path: string[] } & (
  | { keep: "site" | "proposal" }
  | { value: JSONValue }
);

function pathOf(module: Module): ModuleFilePath {
  const path = Internal.getValPath(module);
  if (!path) throw new Error("not a Val module: define it with c.define");
  return path as unknown as ModuleFilePath;
}

/** `value` at `path` in `doc`, leaving `doc` as it was. */
function setAt(doc: JSONValue, path: string[], value: JSONValue | undefined) {
  if (path.length === 0) return value ?? null;
  const [head, ...rest] = path;
  if (Array.isArray(doc)) {
    const copy = [...doc];
    copy[Number(head)] = setAt(copy[Number(head)], rest, value);
    return copy;
  }
  const object =
    typeof doc === "object" && doc !== null
      ? { ...doc }
      : ({} as Record<string, JSONValue>);
  if (rest.length === 0 && value === undefined) {
    delete object[head];
  } else {
    object[head] = setAt(object[head] ?? null, rest, value);
  }
  return object;
}

/**
 * The Val patch that turns a page from `from` into `to`, one top-level field
 * at a time: what a merge commit writes.
 */
function patchFrom(from: JSONValue, to: JSONValue): Operation[] {
  const isObject = (v: JSONValue): v is Record<string, JSONValue> =>
    typeof v === "object" && v !== null && !Array.isArray(v);
  if (!isObject(from) || !isObject(to)) {
    throw new Error("a page is an object or a record at its root");
  }
  const ops: Operation[] = [];
  for (const key of Object.keys(from)) {
    if (!(key in to)) ops.push({ op: "remove", path: [key] });
  }
  for (const [key, value] of Object.entries(to)) {
    if (!(key in from)) ops.push({ op: "add", path: [key], value });
    else if (JSON.stringify(from[key]) !== JSON.stringify(value)) {
      ops.push({ op: "replace", path: [key], value });
    }
  }
  return ops;
}

/**
 * The world's site at its first commit: these modules, as `c.define` made
 * them -- their file paths, schemas and content.
 */
export async function world(modules: Module[]) {
  const { c, config } = initVal();
  const first: Commit = { id: "C0", pages: {} };
  for (const module of modules) {
    first.pages[pathOf(module)] = Internal.getSource(module) as JSONValue;
  }
  const commits: Commit[] = [first];
  const proposals: Proposal[] = [];
  const counters = new Map<string, number>();
  /** The site's pending changes: one store, kept as the site's commits move. */
  const siteStore = new InMemoryPatchStore();
  /**
   * Where every change ever written went, for the check that nothing is lost
   * (`checkNothingLost`): published, or folded into the merge commit an
   * update wrote. Pending and in a proposal are read off the branches.
   */
  const written = new Set<PatchId>();
  const published = new Set<PatchId>();
  const absorbedInto = new Map<PatchId, PatchId>();

  /**
   * A real Val server holding the site as it was at a commit: each module
   * defined again with its own schema and the commit's content, and its
   * `.val.ts` text written from that, which is what a publish rewrites.
   */
  const branchAt = (commit: Commit, store = new InMemoryPatchStore()) => {
    const valModules: ValModules = {
      config,
      modules: modules.map((module) => {
        const path = pathOf(module);
        const schema = Internal.getSchema(module);
        if (!schema) throw new Error(`${path} has no schema`);
        return {
          def: () =>
            Promise.resolve({
              default: c.define(path, schema, commit.pages[path]),
            }),
        };
      }),
    };
    const sourceFiles = Object.fromEntries(
      Object.entries(commit.pages).map(([path, content]) => [
        path,
        // The schema is a placeholder: Val takes it from the module, and a
        // publish rewrites only the content argument.
        `import { s, c } from "./val.config";\n` +
          `export default c.define(${JSON.stringify(path)}, schema, ` +
          `${JSON.stringify(content, null, 2)});\n`,
      ]),
    );
    return new ValOpsMemory(valModules, {
      config,
      sourceFiles,
      patchStore: store,
    });
  };
  let site = branchAt(first, siteStore);

  const head = () => commits[commits.length - 1];
  const commitById = (id: string) => {
    const found = commits.find((commit) => commit.id === id);
    if (!found) throw new Error(`no commit ${id}`);
    return found;
  };
  /** Ids read in scenarios: "kari-1" is Kari's first change. */
  const nextId = (author: string): PatchId => {
    const n = (counters.get(author) ?? 0) + 1;
    counters.set(author, n);
    return `${author}-${n}` as PatchId;
  };
  const pendingOn = async (ops: ValOpsMemory) => {
    const pending = await ops.fetchPatches({ excludePatchOps: false });
    if ("error" in pending && pending.error) {
      throw new Error(`could not read changes: ${pending.error.message}`);
    }
    return pending;
  };
  /** A branch's draft: its commit, and every change on it, as Val applies them. */
  const draftOf = async (ops: ValOpsMemory) => {
    const pending = await pendingOn(ops);
    const analysis = ops.analyzePatches(pending.patches, pending.commits);
    return (await ops.getSources({ ...analysis, ...pending })).sources;
  };
  const write = async (
    ops: ValOpsMemory,
    author: string,
    module: Module,
    patch: Operation[],
    patchId: PatchId = nextId(author),
  ) => {
    const created = await ops.createPatch(
      pathOf(module),
      patch,
      patchId,
      // Ignored here: there is no shared chain to name a parent in.
      { type: "head", headBaseSha: await ops.getBaseSha() },
      null,
      author as AuthorId,
    );
    if (created.kind !== "ok") {
      throw new Error(`${patchId} was refused: ${JSON.stringify(created)}`);
    }
    written.add(patchId);
    return patchId;
  };
  const moduleAt = (path: ModuleFilePath) => {
    const module = modules.find((candidate) => pathOf(candidate) === path);
    if (!module) throw new Error(`no module ${path}`);
    return module;
  };
  const schemaOf = (path: ModuleFilePath) => {
    const schema = Internal.getSchema(moduleAt(path));
    if (!schema) throw new Error(`${path} has no schema`);
    return schema["executeSerialize"]();
  };
  const proposalNamed = (name: string) => {
    const proposal = proposals.find((p) => p.name === name);
    if (!proposal) throw new Error(`no proposal ${name}`);
    return proposal;
  };
  /**
   * Val's plan for merging the proposal into the site as it is now: the pages
   * the proposal changed, as they were where it started, on the site, and in
   * the proposal; and the site's pending changes.
   */
  const planFor = async (proposal: Proposal, withSitePending: boolean) => {
    const base = commitById(proposal.startsAt);
    const now = head();
    const proposalPatches = (await pendingOn(proposal.ops)).patches;
    const proposalDraft = await draftOf(proposal.ops);
    const changed = [...new Set(proposalPatches.map((patch) => patch.path))];
    const sitePending = withSitePending ? (await pendingOn(site)).patches : [];
    const plan = mergePlan({
      pages: Object.fromEntries(
        changed.map((path) => [
          path,
          {
            schema: schemaOf(path),
            base: base.pages[path],
            site: now.pages[path],
            proposal: proposalDraft[path] as JSONValue,
          },
        ]),
      ),
      sitePending: sitePending.map(
        (patch): PendingChange => ({
          patchId: patch.patchId,
          moduleFilePath: patch.path,
          patch: patch.patch,
        }),
      ),
    });
    return { plan, sitePending, proposalPatches };
  };
  /**
   * Every change ever written is in exactly one place: published, pending on
   * the site, or in one open proposal -- or folded into a merge commit that
   * is. Checked after everything that moves changes.
   */
  const checkNothingLost = async () => {
    const places = new Map<PatchId, string[]>();
    const at = (id: PatchId, place: string) =>
      places.set(id, [...(places.get(id) ?? []), place]);
    for (const id of published) at(id, "published");
    for (const patch of (await pendingOn(site)).patches) {
      at(patch.patchId, "pending on the site");
    }
    for (const proposal of proposals) {
      if (proposal.status !== "open") continue;
      for (const patch of (await pendingOn(proposal.ops)).patches) {
        at(patch.patchId, `in “${proposal.name}”`);
      }
    }
    const placeOf = (id: PatchId): string[] => {
      const direct = places.get(id) ?? [];
      const into = absorbedInto.get(id);
      return direct.length > 0 || into === undefined ? direct : placeOf(into);
    };
    for (const id of written) {
      const where = placeOf(id);
      if (where.length === 0) throw new Error(`${id} was lost`);
      if (where.length > 1) {
        throw new Error(`${id} is in two places: ${where.join(", ")}`);
      }
    }
  };
  /** A unique name for a proposal: "Name", then "Name (2)". */
  const freeName = (name: string) => {
    let candidate = name;
    for (let n = 2; proposals.some((p) => p.name === candidate); n++) {
      candidate = `${name} (${n})`;
    }
    return candidate;
  };
  /** An editor's changes, written as the Studio writes them: Val patches to a module. */
  const editor = (author: string, ops: () => ValOpsMemory) => ({
    patch: (module: Module, patch: Operation[]) =>
      write(ops(), author, module, patch),
  });

  return {
    /** An editor working directly on the site: every change is pending there. */
    onSite(author: string) {
      return editor(author, () => site);
    },

    openProposal(name: string, options: { by: string }) {
      const proposal: Proposal = {
        name,
        owners: [options.by],
        startsAt: head().id,
        ops: branchAt(head()),
        status: "open",
      };
      proposals.push(proposal);
      return { name, ...editor(options.by, () => proposal.ops) };
    },

    /**
     * Publish in a proposal: Val plans the merge, and content seals it -- a
     * new site commit with the merged pages, and the site's pending changes
     * the plan names moved into a proposal that starts where the site was.
     */
    async publish(handle: { name: string }): Promise<PublishOutcome> {
      const proposal = proposalNamed(handle.name);
      if (proposal.status !== "open") {
        throw new Error(`${proposal.name} is ${proposal.status}`);
      }
      const before = head();
      const { plan, sitePending, proposalPatches } = await planFor(
        proposal,
        true,
      );
      if (plan.conflicts.length > 0) {
        return { status: "conflicts", conflicts: plan.conflicts };
      }

      // Content's seal: by change id, never looking at a schema.
      const moving = new Set(plan.move.flat());
      const moved = sitePending.filter((patch) => moving.has(patch.patchId));
      if (moved.length !== moving.size) {
        throw new Error("the plan moves a change that is not pending");
      }
      await site.deletePatches([...moving]);
      const after: Commit = {
        id: `C${commits.length}`,
        pages: { ...before.pages, ...plan.merged },
      };
      commits.push(after);
      // What stays pending is replayed over the new commit, as the site's
      // chain is when its base moves.
      site = branchAt(after, siteStore);
      proposal.status = "merged";
      for (const patch of proposalPatches) published.add(patch.patchId);
      for (const ids of plan.move) {
        const changes = moved.filter((patch) => ids.includes(patch.patchId));
        const ops = branchAt(before);
        for (const change of changes) {
          await write(
            ops,
            change.authorId ?? "unknown",
            moduleAt(change.path),
            change.patch,
            change.patchId,
          );
        }
        proposals.push({
          name: freeName(`Moved when “${proposal.name}” was published`),
          owners: [
            ...new Set(changes.map((change) => change.authorId ?? "unknown")),
          ],
          startsAt: before.id,
          ops,
          status: "open",
        });
      }
      await checkNothingLost();
      return {
        status: "published",
        before: before.id,
        after: after.id,
        conflicts: [],
      };
    },

    /**
     * Update from the site: merge the site's last commit into the proposal,
     * as merging main into a pull request does. Every conflict needs a
     * resolution; with them, the proposal starts at the site's last commit and
     * holds one merge commit -- the merged pages, resolutions in.
     */
    async update(
      handle: { name: string },
      resolutions: Resolution[] = [],
    ): Promise<UpdateOutcome> {
      const proposal = proposalNamed(handle.name);
      const { plan, proposalPatches } = await planFor(proposal, false);
      const resolutionOf = (conflict: MergeConflict) =>
        resolutions.find(
          (resolution) =>
            pathOf(resolution.module) === conflict.moduleFilePath &&
            resolution.path.join("/") === conflict.path.join("/"),
        );
      const unresolved = plan.conflicts.filter((c) => !resolutionOf(c));
      if (unresolved.length > 0) {
        return { status: "conflicts", conflicts: unresolved };
      }
      const merged: Record<ModuleFilePath, JSONValue> = { ...plan.merged };
      for (const conflict of plan.conflicts) {
        const resolution = resolutionOf(conflict);
        if (!resolution) continue;
        const value =
          "value" in resolution
            ? resolution.value
            : resolution.keep === "site"
              ? conflict.site
              : conflict.proposal;
        merged[conflict.moduleFilePath] = setAt(
          merged[conflict.moduleFilePath],
          conflict.path,
          value,
        );
      }
      const now = head();
      const ops = branchAt(now);
      const owner = proposal.owners[0];
      const mergeIds: PatchId[] = [];
      for (const [path, content] of Object.entries(merged)) {
        const patch = patchFrom(now.pages[path as ModuleFilePath], content);
        if (patch.length === 0) continue;
        mergeIds.push(
          await write(ops, owner, moduleAt(path as ModuleFilePath), patch),
        );
      }
      const mergeCommit = mergeIds[0];
      for (const patch of proposalPatches) {
        if (mergeCommit === undefined) {
          // Everything the proposal changed is on the site already.
          published.add(patch.patchId);
        } else {
          absorbedInto.set(patch.patchId, mergeCommit);
        }
      }
      for (const id of mergeIds.slice(1)) absorbedInto.set(id, mergeCommit);
      proposal.ops = ops;
      proposal.startsAt = now.id;
      await checkNothingLost();
      return { status: "updated", startsAt: now.id };
    },

    /**
     * The site's own Publish: every pending change, written through Val's
     * real save -- `prepare` patches the `.val.ts` text -- and the commit is
     * the draft that was published.
     */
    async publishSite() {
      const pending = await pendingOn(site);
      const ids = pending.patches.map((patch) => patch.patchId);
      if (ids.length === 0) return { status: "nothing-to-publish" as const };
      const analysis = site.analyzePatches(pending.patches, pending.commits);
      const prepared = await site.prepare({ ...analysis, ...pending });
      if (prepared.hasErrors) {
        throw new Error(
          `the site's publish failed: ${JSON.stringify(prepared.sourceFilePatchErrors)}`,
        );
      }
      const sources = (await site.getSources({ ...analysis, ...pending }))
        .sources;
      await site.deletePatches(ids);
      const after: Commit = { id: `C${commits.length}`, pages: {} };
      for (const path of Object.keys(head().pages) as ModuleFilePath[]) {
        after.pages[path] = sources[path] as JSONValue;
      }
      commits.push(after);
      site = branchAt(after, siteStore);
      for (const id of ids) published.add(id);
      await checkNothingLost();
      return { status: "published" as const, commit: after.id, ids };
    },

    /** A proposal by name, to change or publish: the moved ones too. */
    proposal(name: string) {
      const proposal = proposalNamed(name);
      return {
        name,
        ...editor(proposal.owners[0], () => proposal.ops),
      };
    },

    /** A proposal's pages, as its address shows them. */
    async proposalPage(handle: { name: string }, module: Module) {
      return (await draftOf(proposalNamed(handle.name).ops))[pathOf(module)];
    },

    site: {
      /** A page as visitors see it: the last commit. */
      async page(module: Module) {
        return head().pages[pathOf(module)];
      },
      /** A page as an editor on the site sees it: the last commit and every pending change. */
      async draft(module: Module) {
        return (await draftOf(site))[pathOf(module)];
      },
      async pending() {
        return (await pendingOn(site)).patches.map((patch) => patch.patchId);
      },
    },

    async proposals() {
      return Promise.all(
        proposals.map(async ({ name, owners, startsAt, ops, status }) => ({
          name,
          owners,
          startsAt,
          changes: (await pendingOn(ops)).patches.map((patch) => patch.patchId),
          status,
        })),
      );
    },
  };
}
