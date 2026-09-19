import crypto from "crypto";
import fs from "fs";
import path from "path";
import zlib from "zlib";
import { DeclaredArtifact } from "./protocol";

/**
 * Where an artifact's bytes are, and what it is called on the wire.
 *
 * The key namespace is flat and is content's: `server`, `client`, `css`,
 * `rsc`, `layer`, and paths under `chunk/server/`, `chunk/client/`,
 * `chunk/rsc/`, `asset/` and `public/`. Content validates it and answers with
 * every problem at once, so this does not re-implement the rules - a second,
 * slightly different copy of them here is how a CLI comes to refuse a publish
 * the service would have taken.
 */
export type Artifact = DeclaredArtifact & { file: string };

export type CollectedArtifacts = {
  artifacts: Artifact[];
  totalBytes: number;
  skipped: string[];
};

/**
 * The artifacts to publish, read from a directory laid out by key.
 *
 * The path under the directory IS the artifact key: a file at `public/app.css`
 * is the artifact `public/app.css`, and `server` is the server bundle. Nothing
 * is renamed on the way - an asset is addressed by the path the built code
 * imports it at, so a normalised name produces a bundle whose imports resolve
 * to nothing, at runtime, in the isolate.
 *
 * **This is the seam with the build.** `val publish` uploads artifacts; it does
 * not produce them. Whatever builds the project - today the platform's own
 * builder, which is where the wire, rolldown and dependency-layer steps live -
 * writes this directory, and this reads it.
 */
export async function collectArtifacts(
  dir: string,
): Promise<CollectedArtifacts> {
  const artifacts: Artifact[] = [];
  const skipped: string[] = [];
  let totalBytes = 0;

  const walk = async (current: string): Promise<void> => {
    const entries = await fs.promises.readdir(current, { withFileTypes: true });
    for (const entry of entries) {
      const absolute = path.join(current, entry.name);
      const key = path.relative(dir, absolute).split(path.sep).join("/");
      if (entry.isDirectory()) {
        await walk(absolute);
        continue;
      }
      if (entry.isSymbolicLink()) {
        // A symlinked file is published as its bytes; a symlinked directory is
        // not walked, because one usually comes with a cycle, and a publisher
        // that hangs is worse than one that says what it left out.
        const stat = await fs.promises.stat(absolute).catch(() => null);
        if (stat === null) {
          skipped.push(`${key} (broken symlink)`);
          continue;
        }
        if (!stat.isFile()) {
          skipped.push(
            `${key} (symlink to a ${stat.isDirectory() ? "directory" : "special file"})`,
          );
          continue;
        }
      } else if (!entry.isFile()) {
        skipped.push(`${key} (not a regular file)`);
        continue;
      }
      const { sha256, bytes } = await hashFile(absolute);
      artifacts.push({ key, sha256, bytes, file: absolute });
      totalBytes += bytes;
    }
  };

  await walk(dir);
  // Sorted so two publishes of one build declare the same list in the same
  // order, which is what makes the build hash below reproducible.
  artifacts.sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
  return { artifacts, totalBytes, skipped };
}

async function hashFile(
  absolute: string,
): Promise<{ sha256: string; bytes: number }> {
  const hash = crypto.createHash("sha256");
  let bytes = 0;
  // Streamed: an artifact may be 128 MB, and reading one into a Buffer to hash
  // it is a needless way to run a CI runner out of memory.
  const stream = fs.createReadStream(absolute);
  await new Promise<void>((resolve, reject) => {
    stream.on("data", (chunk) => {
      hash.update(chunk);
      bytes += chunk.length;
    });
    stream.on("end", resolve);
    stream.on("error", reject);
  });
  return { sha256: hash.digest("hex"), bytes };
}

/**
 * The build's own hash, when the build did not say.
 *
 * Content uses it for idempotency - declaring the same `buildHash` twice
 * returns the same publish, which is what makes a retried CI job resume rather
 * than start again - so it has to be a function of the build and nothing else.
 * Every artifact's key and hash, in order: two runs of one build agree, and
 * any change to any artifact is a different publish.
 */
export function buildHashOf(artifacts: Artifact[]): string {
  const hash = crypto.createHash("sha256");
  for (const artifact of artifacts) {
    hash.update(`${artifact.key} ${artifact.sha256}\n`);
  }
  return hash.digest("hex");
}

/**
 * Which dependency layer this build was built against.
 *
 * A layer is sent or named, never neither: the loader reads the head's layer
 * by rev, and a publish that declares no layer at all loses every dependency
 * on the next render. When the layer is being uploaded, its rev is inside it -
 * it is gzipped JSON with a `rev` - so there is nothing to ask the caller for.
 * When it is not, the build knows which stored layer it used, and says so with
 * `--layer-rev`.
 */
export async function layerRevOf(
  artifacts: Artifact[],
): Promise<
  | { status: "ok"; layerRev: string | null }
  | { status: "error"; message: string }
> {
  const layer = artifacts.find((artifact) => artifact.key === "layer");
  if (!layer) {
    return { status: "ok", layerRev: null };
  }
  const bytes = await fs.promises.readFile(layer.file);
  let parsed: unknown;
  try {
    parsed = JSON.parse(zlib.gunzipSync(bytes).toString("utf-8"));
  } catch (err) {
    return {
      status: "error",
      message:
        `The layer artifact is not gzipped JSON: ${
          err instanceof Error ? err.message : String(err)
        }\n\n` +
        "A layer is `{ rev, worker, browser, ... }`, gzipped. Pass --layer-rev to\n" +
        "name a layer content already holds instead of sending one.",
    };
  }
  const rev =
    typeof parsed === "object" && parsed !== null
      ? Reflect.get(parsed, "rev")
      : undefined;
  if (typeof rev !== "string" || rev === "") {
    return {
      status: "error",
      message:
        "The layer artifact has no rev, and a layer that is sent has to say which\n" +
        "it is: that is the name the loader stores and later reuses it by.",
    };
  }
  return { status: "ok", layerRev: rev };
}

/** Where the artifacts are, if the caller did not say. */
export const DEFAULT_ARTIFACTS_DIR = ".val/publish";

export function resolveArtifactsDir(options: {
  root: string;
  dir?: string;
}): { status: "ok"; dir: string } | { status: "error"; message: string } {
  const named = options.dir ?? DEFAULT_ARTIFACTS_DIR;
  const dir = path.resolve(options.root, named);
  if (!fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) {
    return {
      status: "error",
      message:
        `No artifacts to publish: ${dir} is not a directory.\n\n` +
        "Build the project first, then point at what it produced:\n\n" +
        "    npx val publish --artifacts <directory>\n\n" +
        "The path of each file under it is its artifact key - `server`, `client`,\n" +
        "`public/...`, `chunk/client/...`, `layer`.",
    };
  }
  return { status: "ok", dir };
}
