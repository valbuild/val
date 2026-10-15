import type {
  ModuleFilePath,
  PatchId,
  Schema,
  SelectorSource,
  SerializedSchema,
} from "@valbuild/core";
import {
  applyPatch,
  deepClone,
  JSONOps,
  type JSONValue,
  type Operation,
} from "@valbuild/core/patch";
import { result } from "@valbuild/core/fp";
import { mergePlan, type MergeConflict, type MergePlan } from "../mergePlan";

/**
 * A site, its editors and their proposals, in memory: the scenarios of
 * valbuild/home `docs/hosted-publishing.md` step 8.2, played out against the
 * real `mergePlan` and Val's own patch code.
 *
 * Content's part is played here with only what content itself would do: it
 * keeps commits, the pending chain and proposals, and at the seal it carries
 * out the plan by change id. It never looks at a schema. That is the line the
 * design draws, and keeping the model on the same side of it is what lets a
 * second driver (content's real handlers) run the same scenarios later.
 */

type Change = {
  patchId: PatchId;
  author: string;
  moduleFilePath: ModuleFilePath;
  patch: Operation[];
};

type Commit = {
  id: string;
  pages: Record<ModuleFilePath, JSONValue>;
};

type Proposal = {
  name: string;
  owners: string[];
  /** The site commit it started from. */
  startsAt: string;
  changes: Change[];
  status: "open" | "merged";
};

/** A page of the site: its schema and its content when the world starts. */
export type Page = { schema: SerializedSchema; content: JSONValue };

export function page(schema: Schema<SelectorSource>, content: JSONValue): Page {
  return { schema: schema["executeSerialize"](), content };
}

export type PublishOutcome =
  | {
      status: "published";
      /** The site commit the merge went on top of. */
      before: string;
      after: string;
      conflicts: [];
    }
  | { status: "conflicts"; conflicts: MergeConflict[] };

export function world(pages: Record<string, Page>) {
  const schemas: Record<ModuleFilePath, SerializedSchema> = {};
  const first: Commit = { id: "C0", pages: {} };
  for (const [path, page] of Object.entries(pages)) {
    schemas[path as ModuleFilePath] = page.schema;
    first.pages[path as ModuleFilePath] = page.content;
  }
  const commits: Commit[] = [first];
  let sitePending: Change[] = [];
  const proposals: Proposal[] = [];
  const counters = new Map<string, number>();

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
  const apply = (content: JSONValue, changes: Change[]): JSONValue =>
    changes.reduce((doc, change) => {
      const applied = applyPatch(deepClone(doc), new JSONOps(), change.patch);
      if (result.isErr(applied)) {
        throw new Error(
          `${change.patchId} does not apply: ${applied.error.message}`,
        );
      }
      return applied.value;
    }, content);
  const contentOf = (
    pagesAt: Record<ModuleFilePath, JSONValue>,
    moduleFilePath: ModuleFilePath,
    changes: Change[],
  ) =>
    apply(
      pagesAt[moduleFilePath],
      changes.filter((change) => change.moduleFilePath === moduleFilePath),
    );
  const write = (author: string, into: Change[]) => ({
    /** Replace one field: what an editor typing into a field writes. */
    set(moduleFilePath: string, path: string[], value: JSONValue) {
      const change: Change = {
        patchId: nextId(author),
        author,
        moduleFilePath: moduleFilePath as ModuleFilePath,
        patch: [{ op: "replace", path, value }],
      };
      into.push(change);
      return change.patchId;
    },
  });

  return {
    /** An editor working directly on the site: every change is pending. */
    onSite(author: string) {
      return write(author, sitePending);
    },

    openProposal(name: string, options: { by: string }) {
      const proposal: Proposal = {
        name,
        owners: [options.by],
        startsAt: head().id,
        changes: [],
        status: "open",
      };
      proposals.push(proposal);
      return { name, ...write(options.by, proposal.changes) };
    },

    /**
     * Publish in a proposal: Val plans the merge, and content seals it --
     * a new site commit with the merged pages, and the pending changes the
     * plan names moved into a proposal that starts where the site was.
     */
    publish(handle: { name: string }): PublishOutcome {
      const proposal = proposals.find((p) => p.name === handle.name);
      if (!proposal) throw new Error(`no proposal ${handle.name}`);
      const base = commitById(proposal.startsAt);
      const site = head();
      const changed = [
        ...new Set(proposal.changes.map((change) => change.moduleFilePath)),
      ];
      const plan: MergePlan = mergePlan({
        pages: Object.fromEntries(
          changed.map((path) => [
            path,
            {
              schema: schemas[path],
              base: base.pages[path],
              site: site.pages[path],
              proposal: contentOf(base.pages, path, proposal.changes),
            },
          ]),
        ),
        sitePending: sitePending.map(({ patchId, moduleFilePath, patch }) => ({
          patchId,
          moduleFilePath,
          patch,
        })),
      });
      if (plan.conflicts.length > 0) {
        return { status: "conflicts", conflicts: plan.conflicts };
      }
      // Content's seal: generic, by id.
      const moving = new Set(plan.move.flat());
      const moved = sitePending.filter((change) => moving.has(change.patchId));
      if (moved.length !== moving.size) {
        throw new Error("the plan moves a change that is not pending");
      }
      const after: Commit = {
        id: `C${commits.length}`,
        pages: { ...site.pages, ...plan.merged },
      };
      commits.push(after);
      proposal.status = "merged";
      sitePending = sitePending.filter((change) => !moving.has(change.patchId));
      for (const ids of plan.move) {
        const changes = moved.filter((change) => ids.includes(change.patchId));
        proposals.push({
          name: `Moved when “${proposal.name}” was published`,
          owners: [...new Set(changes.map((change) => change.author))],
          startsAt: site.id,
          changes,
          status: "open",
        });
      }
      return {
        status: "published",
        before: site.id,
        after: after.id,
        conflicts: [],
      };
    },

    site: {
      /** A page as visitors see it: the last commit. */
      page(moduleFilePath: string) {
        return head().pages[moduleFilePath as ModuleFilePath];
      },
      /** A page as an editor on the site sees it: the last commit and everything pending. */
      draft(moduleFilePath: string) {
        return contentOf(
          head().pages,
          moduleFilePath as ModuleFilePath,
          sitePending,
        );
      },
      pending() {
        return sitePending.map((change) => change.patchId);
      },
    },

    proposals() {
      return proposals.map(({ name, owners, startsAt, changes, status }) => ({
        name,
        owners,
        startsAt,
        changes: changes.map((change) => change.patchId),
        status,
      }));
    },
  };
}
