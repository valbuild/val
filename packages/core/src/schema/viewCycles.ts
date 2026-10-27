import { SerializedSchema } from ".";
import { ModuleFilePath } from "../val";

/**
 * Every module a schema points at with `s.view(...)`, at any depth.
 *
 * A GENERIC walk over the serialized schema rather than a switch over the
 * container types, and that is deliberate: a schema can hold another schema in
 * places an enumeration keeps forgetting — a richtext's `a` and `img` options
 * each carry one, and a discriminated union's variants are an array of them.
 * Missing a nesting site here means missing a cycle, and a missed cycle is the
 * failure this check exists to prevent.
 */
export function viewTargetsOf(schema: SerializedSchema): ModuleFilePath[] {
  const targets: ModuleFilePath[] = [];
  const seen = new Set<unknown>();
  function walk(node: unknown): void {
    if (typeof node !== "object" || node === null) {
      return;
    }
    // A serialized schema is a tree, but guard anyway: this runs over data the
    // walk does not own, and a cycle here would hang module extraction.
    if (seen.has(node)) {
      return;
    }
    seen.add(node);
    if (Array.isArray(node)) {
      for (const item of node) {
        walk(item);
      }
      return;
    }
    const record: Record<string, unknown> = node as Record<string, unknown>;
    if (record["type"] === "view") {
      const target = record["moduleFilePath"];
      if (typeof target === "string") {
        targets.push(target as ModuleFilePath);
      }
      // A view schema holds nothing else worth walking.
      return;
    }
    for (const value of Object.values(record)) {
      walk(value);
    }
  }
  walk(schema);
  return targets;
}

/**
 * The cycles in a project's views: `A → B → A`, and `A → A`.
 *
 * Each cycle is returned once, as the modules in it in order, rotated so it
 * starts at the lexicographically smallest — otherwise the same cycle would be
 * reported once per module it passes through, worded differently each time.
 */
export function findViewCycles(
  schemas: Record<ModuleFilePath, SerializedSchema>,
): ModuleFilePath[][] {
  const edges = new Map<ModuleFilePath, ModuleFilePath[]>();
  for (const [moduleFilePath, schema] of Object.entries(schemas)) {
    edges.set(moduleFilePath as ModuleFilePath, viewTargetsOf(schema));
  }
  const cycles: ModuleFilePath[][] = [];
  const found = new Set<string>();
  const done = new Set<ModuleFilePath>();
  const stack: ModuleFilePath[] = [];
  const onStack = new Set<ModuleFilePath>();

  function visit(moduleFilePath: ModuleFilePath): void {
    if (done.has(moduleFilePath)) {
      return;
    }
    if (onStack.has(moduleFilePath)) {
      const cycle = stack.slice(stack.indexOf(moduleFilePath));
      const key = canonical(cycle);
      if (!found.has(key)) {
        found.add(key);
        cycles.push(rotate(cycle));
      }
      return;
    }
    stack.push(moduleFilePath);
    onStack.add(moduleFilePath);
    for (const target of edges.get(moduleFilePath) ?? []) {
      // A target that is not a module of this project is a different error —
      // the view names something that does not exist — and is reported where
      // the field is, not here.
      if (edges.has(target)) {
        visit(target);
      }
    }
    stack.pop();
    onStack.delete(moduleFilePath);
    done.add(moduleFilePath);
  }

  for (const moduleFilePath of edges.keys()) {
    visit(moduleFilePath);
  }
  return cycles;
}

function rotate(cycle: ModuleFilePath[]): ModuleFilePath[] {
  let at = 0;
  for (let i = 1; i < cycle.length; i++) {
    if (cycle[i] < cycle[at]) {
      at = i;
    }
  }
  return [...cycle.slice(at), ...cycle.slice(0, at)];
}

function canonical(cycle: ModuleFilePath[]): string {
  return rotate(cycle).join(" -> ");
}

/**
 * A cycle of views, as one error per module in it.
 *
 * Per module rather than once, because a developer opens ONE of them and the
 * error has to be there when they do. Every copy names the whole cycle, so it
 * reads the same wherever it is found.
 */
export function viewCycleErrors(
  schemas: Record<ModuleFilePath, SerializedSchema>,
): { message: string; path: ModuleFilePath }[] {
  const errors: { message: string; path: ModuleFilePath }[] = [];
  for (const cycle of findViewCycles(schemas)) {
    const described = [...cycle, cycle[0]].join(" -> ");
    for (const moduleFilePath of cycle) {
      errors.push({
        path: moduleFilePath,
        message:
          cycle.length === 1
            ? `s.view() cycle: '${moduleFilePath}' views itself. A view must point at another module.`
            : `s.view() cycle: ${described}. Views may not form a cycle.`,
      });
    }
  }
  return errors;
}
