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

function pathOf(module: Module): ModuleFilePath {
  const path = Internal.getValPath(module);
  if (!path) throw new Error("not a Val module: define it with c.define");
  return path as unknown as ModuleFilePath;
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
    return patchId;
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
      const proposal = proposals.find((p) => p.name === handle.name);
      if (!proposal) throw new Error(`no proposal ${handle.name}`);
      const base = commitById(proposal.startsAt);
      const before = head();
      const proposalPending = await pendingOn(proposal.ops);
      const proposalDraft = await draftOf(proposal.ops);
      const changed = [
        ...new Set(proposalPending.patches.map((patch) => patch.path)),
      ];
      const sitePending = (await pendingOn(site)).patches;
      const plan = mergePlan({
        pages: Object.fromEntries(
          changed.map((path) => {
            const schema = Internal.getSchema(
              modules.find((module) => pathOf(module) === path) as Module,
            );
            if (!schema) throw new Error(`${path} has no schema`);
            return [
              path,
              {
                schema: schema["executeSerialize"](),
                base: base.pages[path],
                site: before.pages[path],
                proposal: proposalDraft[path] as JSONValue,
              },
            ];
          }),
        ),
        sitePending: sitePending.map(
          (patch): PendingChange => ({
            patchId: patch.patchId,
            moduleFilePath: patch.path,
            patch: patch.patch,
          }),
        ),
      });
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
      for (const ids of plan.move) {
        const changes = moved.filter((patch) => ids.includes(patch.patchId));
        const ops = branchAt(before);
        for (const change of changes) {
          await write(
            ops,
            change.authorId ?? "unknown",
            modules.find((module) => pathOf(module) === change.path) as Module,
            change.patch,
            change.patchId,
          );
        }
        proposals.push({
          name: `Moved when “${proposal.name}” was published`,
          owners: [
            ...new Set(changes.map((change) => change.authorId ?? "unknown")),
          ],
          startsAt: before.id,
          ops,
          status: "open",
        });
      }
      return {
        status: "published",
        before: before.id,
        after: after.id,
        conflicts: [],
      };
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
