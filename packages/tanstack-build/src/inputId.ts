import type { BuildInput } from "./build";
import { sha256Hex } from "./hash";
import { VERSION } from "./version";
import { withoutBakedJob } from "./wire";

/**
 * A BUILD'S NAME: a hash of what it is built from, not of what came out.
 *
 * So the same inputs are the same build, which the platform builds once and
 * then only refers to (valbuild/home `docs/hosted-publishing.md`, step 3).
 * Everything that can change a byte of the output is in it:
 *
 * - this builder's version;
 * - the target, but not the shell revisions, which the loader picks when it
 *   serves and which no byte of the build depends on;
 * - every file and the embedded source record (`projectSource`), each by
 *   sha256, content included -- the bundle holds it -- and the publish job
 *   baked into `val.server.ts` taken out (`withoutBakedJob`), or no two
 *   builds would ever be the same;
 * - env, public files, assets, and which options are on;
 * - `extraInputs`: what a caller adds to the output after the build, by
 *   name, each value digested here (the Studio's carried public files, and
 *   the live stylesheet it ships in place of an empty one).
 *
 * 32 hex characters, as the output hash it replaces.
 */
export async function buildInputId(input: BuildInput): Promise<string> {
  const {
    shellRev: _shell,
    rscShellRev: _rscShell,
    ...base
  } = input.target.base;
  const record = {
    v: 1,
    builder: VERSION,
    target: { base, project: input.target.project },
    files: await digests(input.files, withoutBakedJob),
    projectSource: input.projectSource
      ? await digests(input.projectSource, withoutBakedJob)
      : null,
    env: input.env ?? {},
    publicFiles: await digests(input.publicFiles ?? {}),
    assets: await digests(input.assets ?? {}),
    dependencyAssets: await digests(input.dependencyAssets ?? {}),
    rsc: input.rsc === true,
    routeSplitter: input.routeSplitter !== undefined,
    loadCssModule: input.loadCssModule !== undefined,
    extra: await digests(input.extraInputs ?? {}),
  };
  return (await sha256Hex(canonicalJson(record))).slice(0, 32);
}

async function digests(
  record: Record<string, string>,
  normalize: (text: string) => string = (text) => text,
): Promise<Record<string, string>> {
  const entries = await Promise.all(
    Object.entries(record).map(
      async ([path, text]): Promise<[string, string]> => [
        path,
        await sha256Hex(normalize(text)),
      ],
    ),
  );
  return Object.fromEntries(entries);
}

/** JSON with every object's keys sorted, so the order a record was built in does not matter. */
function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value !== null && typeof value === "object") {
    const entries = Object.entries(value)
      .filter(([, item]) => item !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries.map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`).join(",")}}`;
  }
  return JSON.stringify(value);
}
