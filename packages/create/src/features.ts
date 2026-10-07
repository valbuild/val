import {
  existsSync,
  readdirSync,
  readFileSync,
  rmdirSync,
  rmSync,
  writeFileSync,
} from "fs";
import { dirname, join } from "path";
import type { CatalogFeatures } from "./catalog";

/**
 * Turning the two optional parts of the template off.
 *
 * The template is downloaded whole and with everything switched on, and this
 * takes back what the answers said no to. That direction is deliberate: a
 * template that is complete is one a person can clone directly and run, and it
 * is one repository rather than a set of fragments that only assemble
 * correctly here. The cost is that every removal below has to be exact, which
 * is why each one is a whole file, a whole directory, a named dependency or a
 * marked region — never a line matched by shape.
 */

export type Features = {
  /** Serve Val's content tools over MCP, so coding agents can edit content. */
  mcp: boolean;
  /** Let those agents upload images. Needs `sharp`, and needs `mcp`. */
  imageUploads: boolean;
};

/**
 * What the image tools file becomes when image uploads are declined.
 *
 * Replaced whole rather than edited, so there is no partial state to get
 * wrong — and the file stays, with the comment, so turning the feature on later
 * is reading one file rather than finding out it was ever an option.
 */
const IMAGE_TOOLS_OFF = `import type { ValToolImpl } from "@valbuild/mcp";

/**
 * Image uploads are off for this project.
 *
 * To turn them on, install \`sharp\` and replace this file with:
 *
 * \`\`\`ts
 * import { createValImageTools } from "@valbuild/mcp";
 * import { sharpImageProcessor } from "@valbuild/mcp/sharp";
 * import sharp from "sharp";
 *
 * export const valImageTools = createValImageTools(sharpImageProcessor(sharp));
 * \`\`\`
 *
 * \`sharp\` is a separate install because it ships a compiled binary per
 * platform, and Val does not put one in every project that installs it.
 */
export const valImageTools: ValToolImpl[] = [];
`;

const SECTION_START = "<!-- val:mcp:start -->";
const SECTION_END = "<!-- val:mcp:end -->";

/**
 * Take the declined features out of a freshly downloaded template.
 *
 * WHAT to take out is the template's to say, in the catalog (`catalog.ts`):
 * the template knows which of its files serve MCP, and this package would be
 * wrong the first time one moved. Each path there has already been checked to
 * stay inside the project.
 *
 * Best effort by design: a template that has moved on and no longer has one of
 * these files should not fail a project's creation over it, and everything
 * removed here is additive to a project that works without it.
 *
 * Returns whether anything was removed, which is what decides whether the
 * template's generated files have to be brought up to date afterwards.
 */
export function applyFeatures(
  projectPath: string,
  features: Features,
  available: CatalogFeatures,
): boolean {
  const { mcp, imageUploads } = available;
  if (mcp !== undefined && !features.mcp) {
    for (const relativePath of mcp.paths) {
      remove(projectPath, relativePath);
    }
    removeDependencies(projectPath, [
      ...mcp.dependencies,
      ...(imageUploads?.dependencies ?? []),
    ]);
    for (const doc of mcp.docs) {
      removeMarkedSection(join(projectPath, doc));
    }
    return true;
  }
  if (imageUploads !== undefined && !features.imageUploads) {
    writeIfPresent(join(projectPath, imageUploads.file), IMAGE_TOOLS_OFF);
    removeDependencies(projectPath, imageUploads.dependencies);
    return true;
  }
  return false;
}

/**
 * Remove a file or directory, and then any directory it leaves empty.
 *
 * The empty parents go too because they are part of what the feature was:
 * `src/app/api/mcp` is the only thing in `src/app/api` in a Next template, and a
 * project with an empty `api` folder looks like something was half-deleted.
 * Never above the project itself.
 */
function remove(projectPath: string, relativePath: string): void {
  const path = join(projectPath, relativePath);
  if (!existsSync(path)) {
    return;
  }
  try {
    rmSync(path, { recursive: true, force: true });
  } catch {
    // Not worth failing the whole creation over.
    return;
  }
  let parent = dirname(path);
  while (parent !== projectPath && parent.startsWith(projectPath)) {
    try {
      if (readdirSync(parent).length > 0) {
        return;
      }
      rmdirSync(parent);
    } catch {
      return;
    }
    parent = dirname(parent);
  }
}

function writeIfPresent(path: string, contents: string): void {
  if (!existsSync(path)) {
    return;
  }
  try {
    writeFileSync(path, contents, "utf-8");
  } catch {
    // As above.
  }
}

/**
 * Drop dependencies by name from the project's package.json.
 *
 * By name and from both blocks, rather than by rewriting the file from a list
 * we hold here: the template owns its dependencies, and a copy of them in this
 * package would be wrong the first time the template added one.
 */
function removeDependencies(projectPath: string, names: string[]): void {
  const packageJsonPath = join(projectPath, "package.json");
  if (!existsSync(packageJsonPath)) {
    return;
  }
  try {
    const contents: unknown = JSON.parse(
      readFileSync(packageJsonPath, "utf-8"),
    );
    if (typeof contents !== "object" || contents === null) {
      return;
    }
    const packageJson: Record<string, unknown> = {
      ...(contents as Record<string, unknown>),
    };
    for (const block of ["dependencies", "devDependencies"]) {
      const deps = packageJson[block];
      if (typeof deps !== "object" || deps === null) {
        continue;
      }
      const remaining: Record<string, unknown> = {
        ...(deps as Record<string, unknown>),
      };
      for (const name of names) {
        delete remaining[name];
      }
      packageJson[block] = remaining;
    }
    // pnpm's list of packages allowed to run install scripts. `sharp` is on it
    // for its binary, and a name left there for a package that is gone is the
    // one trace of the feature a reader would still find.
    const pnpm = packageJson.pnpm;
    if (typeof pnpm === "object" && pnpm !== null && !Array.isArray(pnpm)) {
      const pnpmConfig: Record<string, unknown> = {
        ...(pnpm as Record<string, unknown>),
      };
      const allowed = pnpmConfig.onlyBuiltDependencies;
      if (Array.isArray(allowed)) {
        pnpmConfig.onlyBuiltDependencies = allowed.filter(
          (name) => !names.includes(name),
        );
        packageJson.pnpm = pnpmConfig;
      }
    }
    writeFileSync(
      packageJsonPath,
      `${JSON.stringify(packageJson, null, 2)}\n`,
      "utf-8",
    );
  } catch {
    // As above.
  }
}

/** A doc's MCP section, between the markers the template puts around it. */
function removeMarkedSection(docPath: string): void {
  if (!existsSync(docPath)) {
    return;
  }
  try {
    const contents = readFileSync(docPath, "utf-8");
    const start = contents.indexOf(SECTION_START);
    const end = contents.indexOf(SECTION_END);
    if (start === -1 || end === -1 || end < start) {
      // The markers are the contract. Without them there is no region to be
      // sure of, and a README that documents a feature the project does not
      // have is a smaller problem than one cut in the wrong place.
      return;
    }
    const before = contents.slice(0, start);
    const after = contents.slice(end + SECTION_END.length);
    // A section at the very end leaves nothing after it, and the file should
    // still end in exactly one newline rather than the blank lines around it.
    const rest = after.trim() === "" ? "" : `\n${after.trimStart()}`;
    writeFileSync(docPath, `${before.trimEnd()}\n${rest}`, "utf-8");
  } catch {
    // As above.
  }
}
