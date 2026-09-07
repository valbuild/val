import { existsSync, readFileSync, rmSync, writeFileSync } from "fs";
import { join } from "path";

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

/** Files and directories that exist only to serve MCP. */
const MCP_PATHS = [
  "src/val/mcp.ts",
  "src/val/mcp.images.ts",
  "src/app/api/mcp",
  "src/app/.well-known",
  // Left behind empty once `api/mcp` goes: the Studio's own route lives under
  // `src/app/(val)/api`, not here.
  "src/app/api",
];

/** Dependencies that exist only to serve MCP. */
const MCP_DEPENDENCIES = [
  "@valbuild/mcp",
  "@modelcontextprotocol/server",
  "mcp-handler",
  "zod",
];

/** The dependency the image tool is the whole reason for. */
const IMAGE_DEPENDENCY = "sharp";

/**
 * What `src/val/mcp.images.ts` becomes when image uploads are declined.
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

const README_START = "<!-- val:mcp:start -->";
const README_END = "<!-- val:mcp:end -->";

/**
 * Take the declined features out of a freshly downloaded template.
 *
 * Best effort by design: a template that has moved on and no longer has one of
 * these files should not fail a project's creation over it, and everything
 * removed here is additive to a project that works without it.
 */
export function applyFeatures(projectPath: string, features: Features): void {
  if (!features.mcp) {
    for (const relativePath of MCP_PATHS) {
      remove(join(projectPath, relativePath));
    }
    removeDependencies(projectPath, [...MCP_DEPENDENCIES, IMAGE_DEPENDENCY]);
    removeReadmeSection(projectPath);
    return;
  }
  if (!features.imageUploads) {
    writeIfPresent(join(projectPath, "src/val/mcp.images.ts"), IMAGE_TOOLS_OFF);
    removeDependencies(projectPath, [IMAGE_DEPENDENCY]);
  }
}

function remove(path: string): void {
  if (!existsSync(path)) {
    return;
  }
  try {
    rmSync(path, { recursive: true, force: true });
  } catch {
    // Not worth failing the whole creation over.
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
    writeFileSync(
      packageJsonPath,
      `${JSON.stringify(packageJson, null, 2)}\n`,
      "utf-8",
    );
  } catch {
    // As above.
  }
}

/** The README's MCP section, between the markers the template puts around it. */
function removeReadmeSection(projectPath: string): void {
  const readmePath = join(projectPath, "README.md");
  if (!existsSync(readmePath)) {
    return;
  }
  try {
    const contents = readFileSync(readmePath, "utf-8");
    const start = contents.indexOf(README_START);
    const end = contents.indexOf(README_END);
    if (start === -1 || end === -1 || end < start) {
      // The markers are the contract. Without them there is no region to be
      // sure of, and a README that documents a feature the project does not
      // have is a smaller problem than one cut in the wrong place.
      return;
    }
    const before = contents.slice(0, start);
    const after = contents.slice(end + README_END.length);
    writeFileSync(
      readmePath,
      `${before.trimEnd()}\n\n${after.trimStart()}`,
      "utf-8",
    );
  } catch {
    // As above.
  }
}
