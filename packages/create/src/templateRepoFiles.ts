import { existsSync, rmSync } from "fs";
import { join } from "path";

/**
 * The parts of a template repository that belong to the repository, not to the
 * project scaffolded from it.
 *
 * `degit` copies a template whole — that is what makes a template also a
 * repository someone can clone and run — so anything the template needs for its
 * OWN upkeep arrives in every new project too. A CI workflow is the clear case:
 * `valbuild/template-tanstack-starter` runs one on every push and weekly, to
 * find out when a published `@valbuild/*` release stops working in it. In a
 * scaffolded project that same workflow is a job that installs Playwright and
 * smoke-tests a site its owner has not written yet, on a repository that may
 * not even exist.
 *
 * Removed rather than made conditional in the template, because the template
 * has to keep working as a checkout: a workflow that is only correct after
 * scaffolding is a workflow the template cannot run on itself.
 */
const REPO_ONLY_PATHS = [".github"];

/** Take the template's own repository furniture back out of a new project. */
export function pruneTemplateRepoFiles(projectPath: string): string[] {
  const removed: string[] = [];
  for (const path of REPO_ONLY_PATHS) {
    const fullPath = join(projectPath, path);
    if (existsSync(fullPath)) {
      rmSync(fullPath, { recursive: true, force: true });
      removed.push(path);
    }
  }
  return removed;
}
