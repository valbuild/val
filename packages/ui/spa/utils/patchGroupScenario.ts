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
import { PatchSets, SerializedPatchSet } from "./PatchSets";
import {
  indexPatchSets,
  inChainOrder,
  PatchGroup,
  PatchSetIndex,
  repairGroup,
  RepairPolicy,
  stageClosure,
  validateGroup,
} from "./patchGroups";

/**
 * A scenario harness for patch groups.
 *
 * The point of this file is that the *metadata* is not what we are trying to
 * get right — the content is. So a scenario does not assert on which patch ids
 * ended up in which group; it replays a realistic sequence of edits by several
 * authors, applies the resulting groups for real, and checks that each author's
 * content still says what that author meant it to say.
 *
 * Each scenario produces two things:
 *
 * 1. a **report** — a human-readable trace, asserted as an inline snapshot, so
 *    the whole model can be reviewed by reading the test file rather than by
 *    reasoning about the implementation;
 * 2. a list of **problems** — hard failures (a broken prefix invariant, a patch
 *    that would not apply, an author's intent no longer holding). Tests assert
 *    this is empty, so a real regression fails an assertion and does not merely
 *    change a snapshot.
 *
 * The scenario deliberately simulates publishing by *every* author in turn from
 * the same pre-publish state, because the interesting asymmetry only shows up
 * when you compare the orders: the second author to touch a patch set inherits
 * the first author's work, so who publishes first decides who has to carry whom.
 */

export type Author = string;

export type ScenarioPatch = {
  id: string;
  author: Author;
  /** What this author was trying to do, in their own words. */
  intent: string;
  ops: Operation[];
  /**
   * The same intent as a predicate over the author's *own view* of the content.
   *
   * This is the assertion that matters. It must hold when the author makes the
   * patch, and it must still hold after anybody publishes — including when
   * somebody else's commit has moved the content underneath. A `replace` that
   * silently lands on a different array element is exactly what this catches,
   * and it is not detectable from patch ids alone.
   */
  holds: (doc: JSONValue) => boolean;
};

export type Scenario = {
  name: string;
  moduleFilePath: string;
  schema: Schema<SelectorSource>;
  base: JSONValue;
  /** In chain order — the order the patches were created and are applied. */
  patches: ScenarioPatch[];
  /**
   * Pairs of patch ids that are genuinely independent of each other: neither
   * author should ever have to publish the other's work to publish their own.
   *
   * This is the assertion the whole feature exists for, and it is the one that
   * catches a patch set being too *broad* — two unrelated edits landing in the
   * same set means the closure forces them to move together, which quietly
   * publishes somebody else's change.
   */
  independent?: [string, string][];
  /**
   * Compact rendering of a document for the report. Without this the report is
   * unreadable JSON; with it, a scenario about an array of titles can render as
   * `[A, B*, C]`.
   */
  render?: (doc: JSONValue) => string;
  /** Defaults to "extend" — see `RepairPolicy`. */
  repairPolicy?: RepairPolicy;
};

export type ScenarioResult = {
  report: string;
  problems: string[];
};

export function runScenario(scenario: Scenario): ScenarioResult {
  const policy = scenario.repairPolicy ?? "extend";
  const render = scenario.render ?? ((doc: JSONValue) => JSON.stringify(doc));
  const problems: string[] = [];
  const out = new Report();

  const byId = new Map<string, ScenarioPatch>(
    scenario.patches.map((p) => [p.id, p]),
  );
  const authors = dedupe(scenario.patches.map((p) => p.author));

  out.line(`scenario: ${scenario.name}`);
  out.line(`module:   ${scenario.moduleFilePath}`);
  out.line(`base:     ${render(scenario.base)}`);
  out.blank();

  out.line("chain (oldest first)");
  for (const patch of scenario.patches) {
    out.line(
      `  ${pad(patch.id, 4)} ${pad(patch.author, 6)} ${pad(
        renderOps(patch.ops),
        34,
      )} ${patch.intent}`,
    );
  }
  out.blank();

  // #region replay
  // Rebuild the patch sets incrementally, one patch at a time, exactly as a
  // client does. This matters: patch sets coalesce as patches arrive, so a group
  // that was valid when it was made can be invalidated later by a third party.
  // Replaying gets that for free; computing the patch sets once at the end would
  // hide it.
  const groups = new Map<Author, Set<PatchId>>(
    authors.map((author) => [author, new Set<PatchId>()]),
  );
  const pulledIn: string[] = [];
  const patchSets = new PatchSets();
  let index: PatchSetIndex = indexPatchSets([], []);

  for (let i = 0; i < scenario.patches.length; i++) {
    const patch = scenario.patches[i];
    for (const op of patch.ops) {
      patchSets.insert(
        scenario.moduleFilePath as ModuleFilePath,
        scenario.schema["executeSerialize"](),
        op,
        patch.id as PatchId,
        isoAt(i),
        patch.author,
      );
    }
    const chainSoFar = scenario.patches
      .slice(0, i + 1)
      .map((p) => p.id as PatchId);
    index = indexPatchSets(patchSets.serialize(), chainSoFar);

    // The author stages their own new patch. The closure pulls in whatever the
    // prefix invariant requires — which is how another author's earlier patch
    // ends up in this author's group.
    const own = groups.get(patch.author);
    if (!own) {
      throw new Error(`Unknown author '${patch.author}'`);
    }
    const staged = stageClosure(index, own, [patch.id as PatchId]);
    for (const patchId of staged) {
      if (!own.has(patchId) && patchId !== patch.id) {
        pulledIn.push(
          `  ${patchId} pulled into ${patch.author}'s group as a dependency of ${patch.id}`,
        );
      }
    }
    groups.set(patch.author, staged);

    // Every other group is re-validated too, because this patch may have merged
    // two patch sets and put a hole in a group nobody touched.
    for (const author of authors) {
      if (author === patch.author) {
        continue;
      }
      const group = groups.get(author);
      if (!group || group.size === 0) {
        continue;
      }
      const repair = repairGroup(index, group, policy);
      if (repair.added.length > 0 || repair.removed.length > 0) {
        pulledIn.push(
          `  ${patch.id} merged patch sets, repairing ${author}'s group: ` +
            [
              repair.added.length > 0 ? `+${repair.added.join(",")}` : null,
              repair.removed.length > 0 ? `-${repair.removed.join(",")}` : null,
            ]
              .filter(Boolean)
              .join(" ") +
            ` (policy: ${policy})`,
        );
        groups.set(author, repair.group);
      }
    }
  }
  // #endregion

  out.line("patch sets (final)");
  index.sets.forEach((set, ordinal) => {
    out.line(`  ${pad(index.labels[ordinal], 40)} [${set.join(", ")}]`);
  });
  out.blank();

  out.line("groups as built at creation time");
  for (const author of authors) {
    out.line(
      `  ${pad(author, 6)} {${inChainOrder(index, group(groups, author)).join(
        ", ",
      )}}`,
    );
  }
  if (pulledIn.length > 0) {
    out.blank();
    out.line("why:");
    for (const line of pulledIn) {
      out.line(line);
    }
  }
  out.blank();

  for (const [a, b] of scenario.independent ?? []) {
    const shared = index.sets.filter(
      (set, ordinal) =>
        set.includes(a as PatchId) &&
        set.includes(b as PatchId) &&
        index.labels[ordinal] !== undefined,
    );
    if (shared.length > 0) {
      problems.push(
        `${a} and ${b} are declared independent but share patch set(s) ` +
          `${index.sets
            .map((set, ordinal) =>
              set.includes(a as PatchId) && set.includes(b as PatchId)
                ? index.labels[ordinal]
                : null,
            )
            .filter(Boolean)
            .join(", ")}, so neither can be published without the other`,
      );
    }
  }

  out.line("views (base + own group) — this is what each author sees");
  const views = new Map<Author, JSONValue>();
  for (const author of authors) {
    const applied = apply(
      scenario.base,
      orderedOps(index, group(groups, author), byId),
    );
    if (!applied.ok) {
      problems.push(
        `${author}'s own group does not apply to base: ${applied.error}`,
      );
      out.line(`  ${pad(author, 6)} DOES NOT APPLY: ${applied.error}`);
      continue;
    }
    views.set(author, applied.doc);
    out.line(`  ${pad(author, 6)} ${render(applied.doc)}`);
    problems.push(
      ...checkPrefix(index, group(groups, author), `${author}'s group`),
    );
    problems.push(
      ...checkIntents(
        scenario.patches,
        author,
        group(groups, author),
        applied.doc,
        `${author}'s view before any publish`,
      ),
    );
  }
  out.blank();

  // #region publish
  // Publish each author's group in turn, from the same pre-publish state, and
  // check that everybody else can carry on.
  for (const publisher of authors) {
    const published = group(groups, publisher);
    out.line(
      `publish ${publisher} — commits [${inChainOrder(index, published).join(
        ", ",
      )}]`,
    );
    if (published.size === 0) {
      out.line(`  nothing to publish`);
      out.blank();
      continue;
    }
    const committed = apply(scenario.base, orderedOps(index, published, byId));
    if (!committed.ok) {
      problems.push(
        `publishing ${publisher} does not apply: ${committed.error}`,
      );
      out.line(`  DOES NOT APPLY: ${committed.error}`);
      out.blank();
      continue;
    }
    const newBase = committed.doc;
    out.line(`  new base   ${render(newBase)}`);
    problems.push(
      ...checkIntents(
        scenario.patches,
        publisher,
        published,
        newBase,
        `the commit produced by ${publisher}`,
      ),
    );

    // Published patches are marked applied and leave every group. The patch sets
    // are rebuilt from what is left, since the committed patches are no longer
    // pending.
    const survivingPatches = scenario.patches.filter(
      (p) => !published.has(p.id as PatchId),
    );
    const survivingSets = buildPatchSets(scenario, survivingPatches);
    const survivingIndex = indexPatchSets(
      survivingSets,
      survivingPatches.map((p) => p.id as PatchId),
    );

    for (const author of authors) {
      if (author === publisher) {
        continue;
      }
      const remaining = new Set<PatchId>();
      for (const patchId of group(groups, author)) {
        if (!published.has(patchId)) {
          remaining.add(patchId);
        }
      }
      const violations = validateGroup(survivingIndex, remaining);
      const applied = apply(
        newBase,
        orderedOps(survivingIndex, remaining, byId),
      );
      out.line(
        `  ${pad(author, 6)} {${inChainOrder(survivingIndex, remaining).join(
          ", ",
        )}}${violations.length > 0 ? "  PREFIX VIOLATION" : ""}`,
      );
      problems.push(
        ...checkPrefix(
          survivingIndex,
          remaining,
          `${author}'s group after ${publisher} published`,
        ),
      );
      if (!applied.ok) {
        problems.push(
          `after ${publisher} published, ${author}'s remaining group does not apply: ${applied.error}`,
        );
        out.line(`         DOES NOT APPLY: ${applied.error}`);
        continue;
      }
      out.line(`         ${render(applied.doc)}`);
      // Every one of this author's patches is checked, including the ones the
      // publisher carried along: their effect should now be in the new base.
      problems.push(
        ...checkIntents(
          scenario.patches,
          author,
          allOwn(scenario.patches, author),
          applied.doc,
          `${author}'s view after ${publisher} published`,
        ),
      );
    }
    out.blank();
  }
  // #endregion

  return { report: out.toString(), problems: dedupe(problems) };
}

// #region checks

function checkPrefix(
  index: PatchSetIndex,
  group: PatchGroup,
  what: string,
): string[] {
  return validateGroup(index, group).map(
    (violation) =>
      `${what} breaks the prefix invariant in patch set ${violation.patchSet}: ` +
      `staged [${violation.staged.join(", ")}] but missing [${violation.missing.join(
        ", ",
      )}]`,
  );
}

function checkIntents(
  patches: ScenarioPatch[],
  author: Author,
  group: PatchGroup,
  doc: JSONValue,
  where: string,
): string[] {
  const problems: string[] = [];
  for (const patch of patches) {
    if (patch.author !== author) {
      continue;
    }
    if (!group.has(patch.id as PatchId)) {
      continue;
    }
    if (!patch.holds(doc)) {
      problems.push(
        `${where}: ${patch.id} (${author}) no longer achieves "${patch.intent}"`,
      );
    }
  }
  return problems;
}

// #endregion

// #region plumbing

function buildPatchSets(
  scenario: Scenario,
  patches: ScenarioPatch[],
): SerializedPatchSet {
  const patchSets = new PatchSets();
  patches.forEach((patch, i) => {
    for (const op of patch.ops) {
      patchSets.insert(
        scenario.moduleFilePath as ModuleFilePath,
        scenario.schema["executeSerialize"](),
        op,
        patch.id as PatchId,
        isoAt(i),
        patch.author,
      );
    }
  });
  return patchSets.serialize();
}

function orderedOps(
  index: PatchSetIndex,
  group: PatchGroup,
  byId: Map<string, ScenarioPatch>,
): Operation[] {
  const ops: Operation[] = [];
  for (const patchId of inChainOrder(index, group)) {
    const patch = byId.get(patchId);
    if (!patch) {
      throw new Error(`Unknown patch '${patchId}'`);
    }
    for (const op of patch.ops) {
      // `file` ops carry binary data, not source changes; the source op in the
      // same patch is what moves the content.
      if (op.op !== "file") {
        ops.push(op);
      }
    }
  }
  return ops;
}

type Applied = { ok: true; doc: JSONValue } | { ok: false; error: string };

function apply(base: JSONValue, ops: Operation[]): Applied {
  const applied = applyPatch(deepClone(base), new JSONOps(), ops);
  if (result.isErr(applied)) {
    return { ok: false, error: describeError(applied.error) };
  }
  return { ok: true, doc: applied.value };
}

function describeError(error: unknown): string {
  if (error && typeof error === "object" && "message" in error) {
    return String((error as { message: unknown }).message);
  }
  return String(error);
}

function allOwn(patches: ScenarioPatch[], author: Author): Set<PatchId> {
  return new Set(
    patches.filter((p) => p.author === author).map((p) => p.id as PatchId),
  );
}

function group(groups: Map<Author, Set<PatchId>>, author: Author): PatchGroup {
  const found = groups.get(author);
  if (!found) {
    throw new Error(`Unknown author '${author}'`);
  }
  return found;
}

function renderOps(ops: Operation[]): string {
  return ops
    .map((op) => {
      const path = op.op === "file" ? op.filePath : op.path.join("/");
      const value =
        "value" in op && op.op !== "file"
          ? ` = ${JSON.stringify(op.value)}`
          : "";
      return `${op.op} ${path}${value}`;
    })
    .join("; ");
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
    this.lines.push(text);
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
