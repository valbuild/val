import {
  ModuleFilePath,
  PatchId,
  Schema,
  SelectorSource,
} from "@valbuild/core";
import {
  applyPatch,
  deepClone,
  JSONOps,
  JSONValue,
  Operation,
} from "@valbuild/core/patch";
import { result } from "@valbuild/core/fp";
import { PatchSets } from "./PatchSets";
import {
  editWouldRestage,
  heldPatchSets,
  inChainOrder,
  indexPatchSets,
  PatchGroup,
  PatchSetIndex,
  repairGroup,
  RepairPolicy,
  stageClosure,
  unstageClosure,
  validateGroup,
} from "./patchGroups";

/**
 * A scenario harness for patch groups. See `docs/independent-publish/PLAN.md`.
 *
 * A scenario is a **script of steps** — someone edits, someone stages, someone
 * unstages, someone publishes — replayed in order. After every step the harness
 * prints what changed and what each author now sees, and checks the invariants.
 *
 * Two deliberate choices:
 *
 * 1. **Scenarios assert on content, not on patch ids.** Each edit carries its
 *    author's intent as a predicate over that author's own view. It must hold
 *    while the patch is staged, and must keep holding after anybody publishes. A
 *    `replace` that lands on a different array element after someone else's
 *    commit is exactly what that catches, and it is invisible in group membership.
 *
 * 2. **Patch sets are rebuilt one patch at a time**, and again from scratch after
 *    every publish. Patch sets coalesce as patches arrive and can come apart
 *    again when patches leave, so a group that was valid when it was made can be
 *    invalidated by a third party — or silently repaired by a publish. Replaying
 *    gets that for free; computing the patch sets once at the end would hide it.
 *
 * The output is a trace meant to be read. Where the design still has an open
 * choice — `RepairPolicy` is the live one — run the same scenario under both and
 * compare the traces. That is the point at which the semantics get decided rather
 * than assumed.
 */

export type Author = string;

/** An author makes a change. It is staged into their own group automatically. */
export type EditStep = {
  edit: string;
  by: Author;
  /** What this author was trying to do, in their own words. */
  intent: string;
  /**
   * The ops, as a function of what this author can actually see right now.
   *
   * **This must be a function whenever the path depends on position.** An array
   * index only means something relative to a particular view, and the author picks
   * it while looking at their own. Hand-writing `["items", "2", "title"]` quietly
   * assumes a view the author may not have — which is exactly the class of bug
   * this harness exists to find, so the harness must not be able to make that
   * assumption on their behalf.
   *
   * A plain array is fine for paths that are position-independent: object fields
   * and record keys.
   */
  ops: Operation[] | ((view: JSONValue) => Operation[]);
  /**
   * The same intent as a predicate over the author's own view.
   *
   * Checked whenever the patch is in that author's group or already committed.
   * Not checked while it is unstaged — an unstaged change is *supposed* not to be
   * in the content.
   */
  holds: (doc: JSONValue) => boolean;
};

/** An author explicitly stages patches — their own or somebody else's. */
export type StageStep = { stage: string[]; by: Author };
/** An author explicitly unstages patches. */
export type UnstageStep = { unstage: string[]; by: Author };
/** An author publishes their group. Their patches become the new base. */
export type PublishStep = { publish: Author };

export type Step = EditStep | StageStep | UnstageStep | PublishStep;

export type Scenario = {
  name: string;
  moduleFilePath: string;
  schema: Schema<SelectorSource>;
  base: JSONValue;
  /** A one-line reminder of the shape, for the trace. */
  shape?: string;
  steps: Step[];
  /**
   * Pairs of patch ids that are genuinely independent: neither author should ever
   * have to publish the other's work to publish their own.
   *
   * This is what the feature is for, and the assertion that catches a patch set
   * being too *broad* — two unrelated edits in one set means the closure forces
   * them to move together, quietly publishing somebody else's change.
   */
  independent?: [string, string][];
  /** Compact rendering for the trace. Without it the trace is unreadable JSON. */
  render?: (doc: JSONValue) => string;
  /** Defaults to "extend". Worth running a scenario under both. */
  repairPolicy?: RepairPolicy;
  /**
   * When the script contains no `publish` step, the harness finishes by showing
   * what *would* happen if each author published, from the same state. That
   * side-by-side is what makes the ordering asymmetry visible. Set false to
   * suppress it.
   */
  showPublishOptions?: boolean;
};

export type ScenarioResult = {
  /** The readable trace. Snapshot this. */
  report: string;
  /** Hard failures. Assert this is empty. */
  problems: string[];
  /**
   * Ids of edits the guard refused (`editWouldRestage`). Refusing is a correct
   * outcome, not a failure, so it is reported separately from `problems` — a
   * scenario that expects a refusal asserts on this.
   */
  blocked: string[];
};

export function runScenario(scenario: Scenario): ScenarioResult {
  const run = new Run(scenario);
  run.replay();
  return run.finish();
}

class Run {
  private readonly policy: RepairPolicy;
  private readonly render: (doc: JSONValue) => string;
  private readonly out = new Report();
  private readonly problems: string[] = [];

  /** Pending (uncommitted) edits, in chain order. */
  private pending: EditStep[] = [];
  private readonly allEdits: EditStep[] = [];
  private readonly authors: Author[] = [];
  private readonly groups = new Map<Author, Set<PatchId>>();
  /**
   * What each author has DELIBERATELY unstaged, as opposed to simply never
   * having staged.
   *
   * The group cannot tell those apart — a patch is in it or it is not — and the
   * difference decides what happens when you edit there. Somebody else's work in
   * a set you are now editing was never your decision, so it is staged for you.
   * A region you held back WAS your decision, and quietly re-staging it on your
   * next keystroke would be exactly the "silently enlarging somebody's publish"
   * that this feature exists to prevent. So that one still refuses.
   */
  private readonly heldBack = new Map<Author, Set<PatchId>>();
  private readonly committed = new Set<PatchId>();
  /** Edits the guard refused. Scenarios assert on this. */
  private readonly blocked: string[] = [];
  /** Ops as resolved against their author's view at pick time. */
  private readonly resolvedOps = new Map<string, Operation[]>();
  private base: JSONValue;
  private index: PatchSetIndex = indexPatchSets([], []);
  private step = 0;

  constructor(private readonly scenario: Scenario) {
    this.policy = scenario.repairPolicy ?? "extend";
    this.render = scenario.render ?? ((doc) => JSON.stringify(doc));
    this.base = scenario.base;
    for (const step of scenario.steps) {
      const author = authorOf(step);
      if (!this.groups.has(author)) {
        this.groups.set(author, new Set());
        this.authors.push(author);
      }
    }
  }

  replay() {
    this.out.line(`scenario: ${this.scenario.name}`);
    this.out.line(`module:   ${this.scenario.moduleFilePath}`);
    if (this.scenario.shape) {
      this.out.line(`shape:    ${this.scenario.shape}`);
    }
    this.out.line(`base:     ${this.render(this.base)}`);
    this.out.line(`repair:   ${this.policy}`);
    this.out.blank();

    for (const step of this.scenario.steps) {
      this.step++;
      if ("edit" in step) {
        this.runEdit(step);
      } else if ("stage" in step) {
        this.runStage(step);
      } else if ("unstage" in step) {
        this.runUnstage(step);
      } else {
        this.runPublish(step);
      }
      this.checkAll();
      this.out.blank();
    }

    this.checkIndependence();

    const scripted = this.scenario.steps.some((s) => "publish" in s);
    if (!scripted && (this.scenario.showPublishOptions ?? true)) {
      this.showPublishOptions();
    }
  }

  finish(): ScenarioResult {
    return {
      report: this.out.toString(),
      problems: dedupe(this.problems),
      blocked: this.blocked,
    };
  }

  // #region steps

  private runEdit(step: EditStep) {
    /*
     * Resolve, then STAGE WHAT THE EDIT LANDS IN, then resolve again.
     *
     * The first resolution is only used to learn which patch sets this edit
     * touches — the author's view at that moment may be missing another author's
     * pending work in those sets, so a path picked in it can mean the wrong
     * element. The second resolution is the one that counts: by then the blocking
     * patch sets are staged, the view contains everything the closure will pull
     * in, and the path means what its author thinks it means.
     *
     * "look at patches in the patch set already... and add them first then the
     * new patch". An earlier revision REFUSED the edit instead. That was safe and
     * unusable: with a group defaulting to its owner's closure rather than to
     * everything, every region another author had touched became a locked door.
     * Staging first closes the same window without the door — at the price of
     * enlarging the group, which is the entanglement the compare view shows.
     */
    const first = this.applyGroup(this.base, this.group(step.by));
    if (!first.ok) {
      this.problems.push(
        `step ${this.step}: cannot resolve ${step.edit}, ${step.by}'s view does not apply: ${first.error}`,
      );
      return;
    }
    const probe =
      typeof step.ops === "function" ? step.ops(first.doc) : step.ops;
    const blockers = new Set<PatchId>();
    for (const op of probe) {
      if (op.op === "file") {
        continue;
      }
      // `editWouldRestage` handles `move`/`copy`'s second path itself.
      for (const id of editWouldRestage(
        this.index,
        this.group(step.by),
        this.scenario.moduleFilePath,
        op,
      )) {
        blockers.add(id);
      }
    }
    // Split the blockers: what this author deliberately held back, and what was
    // simply never theirs. Only the second is staged for them.
    const deliberate = this.heldBackOf(step.by);
    const refusing = inChainOrder(this.index, blockers).filter((id) =>
      deliberate.has(id),
    );
    if (refusing.length > 0) {
      this.out.line(
        `      REFUSED     you are holding ${refusing
          .map((id) => `${id} (${this.authorOfPatch(id)})`)
          .join(", ")} here — re-stage before editing`,
      );
      this.blocked.push(step.edit);
      this.showGroups();
      return;
    }
    if (blockers.size > 0) {
      this.out.line(
        `${this.label()} ${step.by} edits into a section held by ${inChainOrder(
          this.index,
          blockers,
        )
          .map((id) => `${id} (${this.authorOfPatch(id)})`)
          .join(", ")}`,
      );
      this.applyStage(
        step.by,
        inChainOrder(this.index, blockers),
        `staged before editing ${step.edit}`,
      );
    }

    // The view the path is actually picked in.
    const view = this.applyGroup(this.base, this.group(step.by));
    if (!view.ok) {
      this.problems.push(
        `step ${this.step}: cannot resolve ${step.edit}, ${step.by}'s view does not apply: ${view.error}`,
      );
      return;
    }
    const ops = typeof step.ops === "function" ? step.ops(view.doc) : step.ops;
    this.resolvedOps.set(step.edit, ops);
    this.out.line(
      `${this.label()} ${step.by} edits ${step.edit}: ${renderOps(ops)}`,
    );
    this.out.line(`      intent      ${step.intent}`);
    this.out.line(`      picked in   ${this.render(view.doc)}`);

    this.pending.push(step);
    this.allEdits.push(step);
    this.reindex();
    this.out.line(`      patch sets  ${this.renderSets()}`);
    // The author stages their own new patch. The closure pulls in whatever the
    // prefix invariant requires — which is how another author's earlier patch
    // ends up in this author's group.
    this.applyStage(
      step.by,
      [step.edit as PatchId],
      `required by ${step.edit}`,
    );
    /*
     * And that is ALL. The patch does not join anybody else's group.
     *
     * An earlier revision fanned every new patch out to every open group, on the
     * reasoning that a path only means what its author thought it meant if their
     * view already held everything the closure could pull in. The conclusion was
     * too broad: what the author's view has to hold is everything that could SHIFT
     * THEIR PATHS, and that set is exactly their patch sets — which `applyStage`
     * above has already pulled in. Another author's patch in a DIFFERENT patch set
     * cannot move anything here, so it has no business in this group, and keeping
     * it out is what makes the publish independent.
     *
     * See "why a group is not a blanket" in `patchGroups.ts`.
     */
    this.repairOthers(step.by, `${step.edit} changed the patch sets`);
    this.showGroups();
  }

  private runStage(step: StageStep) {
    this.out.line(`${this.label()} ${step.by} stages ${step.stage.join(", ")}`);
    this.applyStage(
      step.by,
      step.stage.map((id) => id as PatchId),
      `required by ${step.stage.join(", ")}`,
    );
    this.showGroups();
  }

  private runUnstage(step: UnstageStep) {
    this.out.line(
      `${this.label()} ${step.by} unstages ${step.unstage.join(", ")}`,
    );
    const before = this.group(step.by);
    const after = unstageClosure(
      this.index,
      before,
      step.unstage.map((id) => id as PatchId),
    );
    const dropped = Array.from(before).filter(
      (id) => !after.has(id) && !step.unstage.includes(id),
    );
    if (dropped.length > 0) {
      this.out.line(
        `      also dropped ${inChainOrder(this.index, new Set(dropped))
          .map((id) => `${id} (${this.authorOfPatch(id)})`)
          .join(", ")} — they were built on top of it`,
      );
    }
    this.groups.set(step.by, after);
    /*
     * Record the REQUEST, not just what left the group.
     *
     * Now that a group defaults to its owner's closure, unstaging somebody else's
     * patch is usually a no-op on the set — it was never in there. It is still a
     * declaration: "I do not want this in my publish." If only the ids that
     * actually left were recorded, that declaration would evaporate, and the next
     * edit in that region would helpfully stage the very thing the author had just
     * pushed away.
     */
    const held = this.heldBackOf(step.by);
    for (const id of step.unstage) {
      held.add(id as PatchId);
    }
    for (const id of before) {
      if (!after.has(id)) {
        held.add(id);
      }
    }
    this.showGroups();
  }

  private runPublish(step: PublishStep) {
    const group = this.group(step.publish);
    const ids = inChainOrder(this.index, group);
    this.out.line(
      `${this.label()} ${step.publish} publishes [${ids.join(", ")}]`,
    );
    if (ids.length === 0) {
      this.out.line(`      nothing staged — publish would be a no-op`);
      return;
    }
    const carried = ids.filter((id) => this.authorOfPatch(id) !== step.publish);
    if (carried.length > 0) {
      this.out.line(
        `      carries      ${carried
          .map((id) => `${id} (${this.authorOfPatch(id)})`)
          .join(", ")}`,
      );
    }
    const applied = this.applyGroup(this.base, group);
    if (!applied.ok) {
      this.problems.push(
        `step ${this.step}: ${step.publish}'s publish does not apply: ${applied.error}`,
      );
      this.out.line(`      DOES NOT APPLY: ${applied.error}`);
      return;
    }
    this.base = applied.doc;
    for (const id of group) {
      this.committed.add(id);
    }
    // Published patches are marked applied and leave every group.
    for (const author of this.authors) {
      const remaining = new Set(this.group(author));
      let lost = false;
      for (const id of group) {
        lost = remaining.delete(id) || lost;
      }
      if (lost && author !== step.publish) {
        this.out.line(
          `      ${author}'s group loses the patches that were just committed`,
        );
      }
      this.groups.set(author, remaining);
    }
    this.pending = this.pending.filter((p) => !group.has(p.edit as PatchId));
    // Rebuilt from scratch: removing a patch can also *un*-merge patch sets, if
    // the broad path that merged them is the one that got committed.
    this.reindex();
    this.out.line(`      new base    ${this.render(this.base)}`);
    this.out.line(`      patch sets  ${this.renderSets()}`);
    this.repairOthers(step.publish, "the commit changed the patch sets");
    this.showGroups();
  }

  // #endregion
  // #region mechanics

  private heldBackOf(author: Author): Set<PatchId> {
    const existing = this.heldBack.get(author);
    if (existing) {
      return existing;
    }
    const created = new Set<PatchId>();
    this.heldBack.set(author, created);
    return created;
  }

  private applyStage(author: Author, ids: PatchId[], why: string) {
    const before = this.group(author);
    const after = stageClosure(this.index, before, ids);
    // Staging is a decision too: it retracts any hold it covers.
    const held = this.heldBackOf(author);
    for (const id of after) {
      held.delete(id);
    }
    const pulled = Array.from(after).filter(
      (id) => !before.has(id) && !ids.includes(id),
    );
    if (pulled.length > 0) {
      this.out.line(
        `      also staged ${inChainOrder(this.index, new Set(pulled))
          .map((id) => `${id} (${this.authorOfPatch(id)})`)
          .join(", ")} — ${why}`,
      );
    }
    this.groups.set(author, after);
  }

  private repairOthers(except: Author, why: string) {
    for (const author of this.authors) {
      if (author === except) {
        continue;
      }
      const group = this.group(author);
      if (group.size === 0) {
        continue;
      }
      const repair = repairGroup(this.index, group, this.policy);
      if (repair.added.length === 0 && repair.removed.length === 0) {
        continue;
      }
      const changes = [
        repair.added.length > 0
          ? `+${inChainOrder(this.index, new Set(repair.added)).join(",")}`
          : null,
        repair.removed.length > 0 ? `-${repair.removed.join(",")}` : null,
      ]
        .filter(Boolean)
        .join(" ");
      this.out.line(
        `      repaired ${author}'s group ${changes} — ${why} (policy: ${this.policy})`,
      );
      this.groups.set(author, repair.group);
    }
  }

  private reindex() {
    const patchSets = new PatchSets();
    this.pending.forEach((patch, i) => {
      patchSets.insert(
        this.scenario.moduleFilePath as ModuleFilePath,
        this.scenario.schema["executeSerialize"](),
        this.opsOf(patch),
        patch.edit as PatchId,
        isoAt(i),
        patch.by,
      );
    });
    this.index = indexPatchSets(
      patchSets.serialize(),
      this.pending.map((p) => p.edit as PatchId),
    );
  }

  private applyGroup(base: JSONValue, group: PatchGroup): Applied {
    const ops: Operation[] = [];
    for (const id of inChainOrder(this.index, group)) {
      const patch = this.pending.find((p) => p.edit === id);
      if (!patch) {
        throw new Error(`Patch '${id}' is in a group but is not pending`);
      }
      for (const op of this.opsOf(patch)) {
        // `file` ops carry binary data, not source changes; the source op in the
        // same patch is what moves the content.
        if (op.op !== "file") {
          ops.push(op);
        }
      }
    }
    const applied = applyPatch(deepClone(base), new JSONOps(), ops);
    if (result.isErr(applied)) {
      return { ok: false, error: describeError(applied.error) };
    }
    return { ok: true, doc: applied.value };
  }

  // #endregion
  // #region checks

  private checkAll() {
    for (const author of this.authors) {
      const group = this.group(author);
      for (const violation of validateGroup(this.index, group)) {
        this.problems.push(
          `step ${this.step}: ${author}'s group breaks the prefix invariant in ` +
            `patch set ${violation.patchSet}: staged [${violation.staged.join(
              ", ",
            )}] but missing [${violation.missing.join(", ")}]`,
        );
      }
      const applied = this.applyGroup(this.base, group);
      if (!applied.ok) {
        this.problems.push(
          `step ${this.step}: ${author}'s group does not apply: ${applied.error}`,
        );
        continue;
      }
      for (const patch of this.allEdits) {
        if (patch.by !== author) {
          continue;
        }
        const staged =
          group.has(patch.edit as PatchId) ||
          this.committed.has(patch.edit as PatchId);
        if (!staged) {
          continue;
        }
        if (!patch.holds(applied.doc)) {
          this.problems.push(
            `step ${this.step}: in ${author}'s own view, ${patch.edit} no longer ` +
              `achieves "${patch.intent}"`,
          );
        }
      }
    }
  }

  private checkIndependence() {
    for (const [a, b] of this.scenario.independent ?? []) {
      const shared = this.index.sets
        .map((set, ordinal) =>
          set.includes(a as PatchId) && set.includes(b as PatchId)
            ? this.index.labels[ordinal]
            : null,
        )
        .filter((label): label is string => label !== null);
      if (shared.length > 0) {
        this.problems.push(
          `${a} and ${b} are declared independent but share patch set(s) ` +
            `${shared.join(", ")}, so neither can be published without the other`,
        );
      }
    }
  }

  // #endregion
  // #region reporting

  private showPublishOptions() {
    this.out.line("if each author published now, from this same state:");
    for (const author of this.authors) {
      const group = this.group(author);
      const ids = inChainOrder(this.index, group);
      if (ids.length === 0) {
        this.out.line(`  ${pad(author, 6)} nothing staged`);
        continue;
      }
      const applied = this.applyGroup(this.base, group);
      const carried = ids.filter((id) => this.authorOfPatch(id) !== author);
      this.out.line(
        `  ${pad(author, 6)} commits [${ids.join(", ")}]` +
          (carried.length > 0
            ? ` — carries ${carried
                .map((id) => `${id} (${this.authorOfPatch(id)})`)
                .join(", ")}`
            : " — only their own work"),
      );
      this.out.line(`         ${this.describe(applied)}`);
    }
  }

  private showGroups() {
    for (const author of this.authors) {
      const group = this.group(author);
      const held = heldPatchSets(this.index, group);
      this.out.line(
        `      ${pad(author, 6)} ${pad(
          `{${inChainOrder(this.index, group).join(", ")}}`,
          16,
        )} ${this.describe(this.applyGroup(this.base, group))}` +
          (held.length > 0
            ? `   holds ${held
                .map(
                  ({ patchSet, unstaged }) =>
                    `${shortLabel(patchSet)} [${unstaged.join(",")}]`,
                )
                .join(" ")}`
            : ""),
      );
    }
  }

  private describe(applied: Applied): string {
    return applied.ok
      ? this.render(applied.doc)
      : `DOES NOT APPLY: ${applied.error}`;
  }

  private renderSets(): string {
    if (this.index.sets.length === 0) {
      return "(none)";
    }
    return this.index.sets
      .map(
        (set, ordinal) =>
          `${shortLabel(this.index.labels[ordinal])} [${set.join(", ")}]`,
      )
      .join("   ");
  }

  private label(): string {
    return pad(`${this.step}.`, 3);
  }

  // #endregion

  private group(author: Author): PatchGroup {
    const found = this.groups.get(author);
    if (!found) {
      throw new Error(`Unknown author '${author}'`);
    }
    return found;
  }

  private opsOf(patch: EditStep): Operation[] {
    const resolved = this.resolvedOps.get(patch.edit);
    if (!resolved) {
      throw new Error(`Ops for '${patch.edit}' were never resolved`);
    }
    return resolved;
  }

  private authorOfPatch(id: PatchId): Author {
    const patch = this.allEdits.find((p) => p.edit === id);
    return patch ? patch.by : "?";
  }
}

type Applied = { ok: true; doc: JSONValue } | { ok: false; error: string };

// #region plumbing

function authorOf(step: Step): Author {
  if ("edit" in step || "stage" in step || "unstage" in step) {
    return step.by;
  }
  return step.publish;
}

function describeError(error: unknown): string {
  if (error && typeof error === "object" && "message" in error) {
    return String((error as { message: unknown }).message);
  }
  return String(error);
}

function renderOps(ops: Operation[]): string {
  return ops
    .map((op) => {
      if (op.op === "file") {
        return `file ${op.filePath}`;
      }
      const from =
        op.op === "move" || op.op === "copy"
          ? ` from ${op.from.join("/")}`
          : "";
      const value = "value" in op ? ` = ${JSON.stringify(op.value)}` : "";
      return `${op.op} ${op.path.join("/")}${from}${value}`;
    })
    .join("; ");
}

/** Patch set paths are long and the module file path is already in the header. */
function shortLabel(label: string): string {
  const delimiter = label.indexOf("?");
  return delimiter === -1 ? "?(whole module)" : label.slice(delimiter);
}

/** Deterministic timestamps: the harness must not depend on wall-clock time. */
function isoAt(i: number): string {
  const day = String(i + 1).padStart(2, "0");
  return `2024-01-${day}T00:00:00.000Z`;
}

function dedupe<T>(items: T[]): T[] {
  return Array.from(new Set(items));
}

function pad(text: string, width: number): string {
  return text.length >= width ? text : text + " ".repeat(width - text.length);
}

class Report {
  private readonly lines: string[] = [];
  line(text: string) {
    this.lines.push(text.replace(/\s+$/, ""));
  }
  blank() {
    if (this.lines.length > 0 && this.lines[this.lines.length - 1] !== "") {
      this.lines.push("");
    }
  }
  toString(): string {
    return this.lines.join("\n").replace(/\s+$/, "");
  }
}

// #endregion
