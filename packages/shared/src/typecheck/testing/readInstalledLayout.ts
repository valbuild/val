import * as fs from "node:fs";
import * as path from "node:path";

/**
 * The symlinks and package directories a real `pnpm install` left in a
 * project's `node_modules`, with the project's directory written as `root`,
 * so that it can be compared with `computePnpmLayout`. Node only: for tests
 * and the scripts that make their fixtures.
 */
export type InstalledLayout = {
  links: Record<string, string>;
  packages: string[];
};

function entriesOf(modulesDir: string): string[] {
  if (!fs.existsSync(modulesDir)) return [];
  const out: string[] = [];
  for (const entry of fs.readdirSync(modulesDir)) {
    if (entry.startsWith(".")) continue;
    if (entry.startsWith("@")) {
      const scope = path.join(modulesDir, entry);
      if (fs.lstatSync(scope).isSymbolicLink()) {
        out.push(entry);
        continue;
      }
      for (const scoped of fs.readdirSync(scope))
        out.push(`${entry}/${scoped}`);
    } else {
      out.push(entry);
    }
  }
  return out;
}

export function readInstalledLayout(
  projectDir: string,
  importerIds: string[],
  root = "/project",
): InstalledLayout {
  const project = path.resolve(projectDir);
  const toRoot = (absolute: string) => {
    const relative = path.relative(project, absolute).split(path.sep).join("/");
    return relative === "" ? root : `${root}/${relative}`;
  };
  const links: Record<string, string> = {};
  const packages: string[] = [];
  const readModulesDir = (modulesDir: string, own: string | null) => {
    for (const entry of entriesOf(modulesDir)) {
      const full = path.join(modulesDir, entry);
      const stat = fs.lstatSync(full);
      if (stat.isSymbolicLink()) {
        const target = path.resolve(path.dirname(full), fs.readlinkSync(full));
        links[toRoot(full)] = toRoot(target);
      } else if (entry === own) {
        packages.push(toRoot(full));
      }
    }
  };
  for (const id of importerIds) {
    readModulesDir(path.join(project, id, "node_modules"), null);
  }
  const store = path.join(project, "node_modules", ".pnpm");
  for (const slot of fs.readdirSync(store)) {
    if (
      slot === "node_modules" ||
      slot.startsWith(".") ||
      slot === "lock.yaml"
    ) {
      continue;
    }
    const modulesDir = path.join(store, slot, "node_modules");
    if (!fs.existsSync(modulesDir)) continue;
    // The slot's own package is the one real directory in it.
    for (const entry of entriesOf(modulesDir)) {
      const full = path.join(modulesDir, entry);
      if (!fs.lstatSync(full).isSymbolicLink()) {
        readModulesDir(modulesDir, entry);
        break;
      }
    }
  }
  readModulesDir(path.join(store, "node_modules"), null);
  packages.sort();
  return { links, packages };
}
