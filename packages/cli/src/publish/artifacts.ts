import crypto from "crypto";
import fs from "fs";
import path from "path";
import { ArtifactDescriptor } from "./protocol";

export type CollectedArtifacts = {
  artifacts: ArtifactDescriptor[];
  totalBytes: number;
  /** Things skipped, and why. Printed: a silent omission is a broken site. */
  skipped: string[];
};

/**
 * Every file under `dir`, hashed.
 *
 * The hash is the whole protocol: content answers `POST /v1/publish` with a
 * presigned URL for each artifact it does not already have, so an unchanged
 * build uploads nothing and a one-line change uploads one chunk. That only
 * works if two machines hashing the same bytes agree, which is why this is
 * sha256 over the bytes and nothing else - no path, no mtime, no mode.
 *
 * Paths are POSIX and relative, so a publish from Windows names the same
 * artifact as a publish from a Linux runner, and sorted, so two publishes of
 * one build send the same list in the same order.
 */
export async function collectArtifacts(
  dir: string,
): Promise<CollectedArtifacts> {
  const artifacts: ArtifactDescriptor[] = [];
  const skipped: string[] = [];
  let totalBytes = 0;

  const walk = async (current: string): Promise<void> => {
    const entries = await fs.promises.readdir(current, { withFileTypes: true });
    for (const entry of entries) {
      const absolute = path.join(current, entry.name);
      const relative = path.relative(dir, absolute).split(path.sep).join("/");
      if (entry.isDirectory()) {
        await walk(absolute);
        continue;
      }
      if (entry.isSymbolicLink()) {
        // A symlinked file is published as its bytes; a symlinked directory is
        // not walked, because a build output that contains one usually
        // contains a cycle with it, and a publisher that hangs is worse than
        // one that says what it left out.
        const stat = await fs.promises.stat(absolute).catch(() => null);
        if (stat === null) {
          skipped.push(`${relative} (broken symlink)`);
          continue;
        }
        if (stat.isDirectory()) {
          skipped.push(`${relative} (symlink to a directory)`);
          continue;
        }
        if (!stat.isFile()) {
          skipped.push(`${relative} (not a regular file)`);
          continue;
        }
      } else if (!entry.isFile()) {
        skipped.push(`${relative} (not a regular file)`);
        continue;
      }
      const { hash, size } = await hashFile(absolute);
      artifacts.push({ path: relative, hash, size });
      totalBytes += size;
    }
  };

  await walk(dir);
  artifacts.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  return { artifacts, totalBytes, skipped };
}

async function hashFile(
  absolute: string,
): Promise<{ hash: string; size: number }> {
  const hash = crypto.createHash("sha256");
  let size = 0;
  // Streamed rather than read whole: a build output holds bundles and images,
  // and reading a 200 MB one into a Buffer to hash it is a needless way to run
  // a CI runner out of memory.
  const stream = fs.createReadStream(absolute);
  await new Promise<void>((resolve, reject) => {
    stream.on("data", (chunk) => {
      hash.update(chunk);
      size += chunk.length;
    });
    stream.on("end", resolve);
    stream.on("error", reject);
  });
  return { hash: hash.digest("hex"), size };
}

/**
 * Which directory holds the build.
 *
 * Named by `--dir` when the caller knows, and otherwise the first of the
 * conventional outputs that exists: `.output` is what TanStack Start's build
 * leaves behind, `dist` and `build` are what most else does, `.next` is Next.
 * Order matters - a Nitro build leaves `dist` behind as an intermediate, and
 * publishing that would publish half a site.
 *
 * Refusing when there is nothing to find is the point: guessing here publishes
 * the wrong directory, and a wrong publish is live before anybody reads the
 * output.
 */
export const CONVENTIONAL_BUILD_DIRS = [".output", "dist", "build", ".next"];

export function resolveBuildDir(options: {
  root: string;
  dir?: string;
}):
  | { status: "ok"; dir: string; wasDetected: boolean }
  | { status: "error"; message: string } {
  if (options.dir) {
    const dir = path.resolve(options.root, options.dir);
    if (!fs.existsSync(dir)) {
      return { status: "error", message: `No such directory: ${dir}` };
    }
    if (!fs.statSync(dir).isDirectory()) {
      return { status: "error", message: `Not a directory: ${dir}` };
    }
    return { status: "ok", dir, wasDetected: false };
  }
  for (const candidate of CONVENTIONAL_BUILD_DIRS) {
    const dir = path.join(options.root, candidate);
    if (fs.existsSync(dir) && fs.statSync(dir).isDirectory()) {
      return { status: "ok", dir, wasDetected: true };
    }
  }
  return {
    status: "error",
    message:
      `Found nothing to publish in ${options.root}.\n\n` +
      `Build the project first, or name the directory:\n\n` +
      `    npx val publish --dir <directory>\n\n` +
      `Looked for: ${CONVENTIONAL_BUILD_DIRS.join(", ")}.`,
  };
}
