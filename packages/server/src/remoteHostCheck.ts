import { Internal } from "@valbuild/core";

/**
 * Does the host a platform ref names still serve the project the ref names?
 *
 * A ref served by the platform loader names the project's host at the time
 * the file was added: `https://www.acme.no/_val/file/p/3f9a2c1/…`. When the
 * project drops `www.acme.no`, the bytes are still there, at
 * `3f9a2c1.valstart.dev`, but every ref that names the old domain points at a
 * host that no longer serves them. This is the question that finds those refs,
 * and `rewriteRefHost` is what the fix (`remote:rewrite-host`) does about it.
 * See valbuild/home `docs/remote-files-on-platform.md`, "Rewriting refs after a
 * domain is removed", and `docs/plans/studio-validate.md`, step 6.
 *
 * Asked of the host itself (`GET <host>/_val/project`), not of content: the
 * host's answer covers DNS, the certificate and the loader's mapping in one,
 * it needs no credential, and it works for a ref that names a project other
 * than this one -- a project seeded from a template has refs naming the
 * template's.
 */

/** The domain every platform project is always served at, by its public id. */
export const PLATFORM_SITES_DOMAIN = "valstart.dev";

/** What a platform ref's host part ends with. */
const PLATFORM_PREFIX = "/_val";

/**
 * The host every platform ref of `publicProjectId` can always be pointed at:
 * `<public id>.valstart.dev` is permanent (decision 4 of the remote-files
 * plan), and the loader serves a project's files there whatever else it has.
 */
export function fallbackRemoteHost(publicProjectId: string): string {
  return `https://${publicProjectId}.${PLATFORM_SITES_DOMAIN}${PLATFORM_PREFIX}`;
}

/**
 * Only a platform ref is asked about. `remote.val.build` is not a platform
 * host and is not going away, and a ref already on the project's own
 * `valstart.dev` address is on the fallback, which always serves it.
 */
export function needsHostCheck(remoteHost: string, projectId: string): boolean {
  return (
    remoteHost.endsWith(PLATFORM_PREFIX) &&
    remoteHost !== fallbackRemoteHost(projectId)
  );
}

/** `ref` with its host part replaced, and everything else as it was. */
export function rewriteRefHost(ref: string, remoteHost: string): string | null {
  const parsed = Internal.remote.splitRemoteRef(ref);
  if (parsed.status === "error") {
    return null;
  }
  return Internal.remote.createRemoteRef(remoteHost, {
    publicProjectId: parsed.projectId,
    coreVersion: parsed.version,
    bucket: parsed.bucket,
    validationHash: parsed.validationHash,
    fileHash: parsed.fileHash,
    filePath: parsed.filePath,
  });
}

/**
 * - `serves`: the host answered for the project the ref names.
 * - `other-project`: it answered, for another one -- the domain was moved to
 *   a different project, and decision 5 means it will not serve these files.
 * - `no-site`: it answered, but serves no project at all (the loader's 404 for
 *   a domain nobody has mapped any more).
 * - `unreachable`: no answer. A domain whose DNS was removed looks like this,
 *   and so does a host that is down for a minute, which is why the row says
 *   which it saw.
 */
export type HostServes =
  | { status: "serves" }
  | { status: "other-project"; publicProjectId: string }
  | { status: "no-site"; httpStatus: number }
  | { status: "unreachable"; reason: string };

export type AskHostProject = (
  remoteHost: string,
) => Promise<
  | { status: "answered"; publicProjectId: string }
  | { status: "no-site"; httpStatus: number }
  | { status: "unreachable"; reason: string }
>;

const ASK_TIMEOUT_MS = 8_000;

/** `GET <host>/_val/project`, answered by the platform loader. */
export const askHostProject: AskHostProject = async (remoteHost) => {
  try {
    const res = await fetch(`${remoteHost}/project`, {
      signal: AbortSignal.timeout(ASK_TIMEOUT_MS),
    });
    if (!res.ok) {
      return { status: "no-site", httpStatus: res.status };
    }
    const body: unknown = await res.json();
    if (
      typeof body === "object" &&
      body !== null &&
      "publicProjectId" in body &&
      typeof body.publicProjectId === "string"
    ) {
      return { status: "answered", publicProjectId: body.publicProjectId };
    }
    return { status: "no-site", httpStatus: res.status };
  } catch (err) {
    return {
      status: "unreachable",
      reason:
        err instanceof Error && err.name === "TimeoutError"
          ? `No answer within ${ASK_TIMEOUT_MS / 1000} s`
          : err instanceof Error
            ? err.message
            : "Unknown error",
    };
  }
};

/**
 * Hosts that answered for a project, and when: one question per host, not per
 * ref, and not again for a few minutes. Only a "serves" is kept, for the same
 * reason `remoteFileCheck` keeps only "found": a host that stopped serving has
 * to be noticed, and one that did not answer has to be asked again.
 */
const SERVES_FOR_MS = 5 * 60_000;
const servesAt = new Map<string, number>();

export function clearHostAnswers() {
  servesAt.clear();
}

export async function hostServes(
  remoteHost: string,
  projectId: string,
  ask: AskHostProject = askHostProject,
): Promise<HostServes> {
  const key = `${remoteHost} ${projectId}`;
  const at = servesAt.get(key);
  if (at !== undefined && Date.now() - at < SERVES_FOR_MS) {
    return { status: "serves" };
  }
  const answer = await ask(remoteHost);
  if (answer.status !== "answered") {
    return answer;
  }
  if (answer.publicProjectId !== projectId) {
    return {
      status: "other-project",
      publicProjectId: answer.publicProjectId,
    };
  }
  servesAt.set(key, Date.now());
  return { status: "serves" };
}

/**
 * `ask`, asking each host once for as long as the returned function is kept:
 * one check, not the life of the server. A check walks its refs in order, so
 * without it every ref on a host that does not answer waits out its own
 * timeout -- 150 images on a dead domain is 20 minutes. Kept per check rather
 * than in {@link hostServes}'s cache because a host that did not answer has
 * to be asked again by the next one.
 */
export function askOncePerHost(
  ask: AskHostProject = askHostProject,
): AskHostProject {
  const answers = new Map<string, ReturnType<AskHostProject>>();
  return (remoteHost) => {
    let answer = answers.get(remoteHost);
    if (answer === undefined) {
      answer = ask(remoteHost);
      answers.set(remoteHost, answer);
    }
    return answer;
  };
}

/** `www.acme.no`, from `https://www.acme.no/_val`: how a person names a host. */
export function hostNameOfRemoteHost(remoteHost: string): string {
  try {
    return new URL(remoteHost).host;
  } catch {
    return remoteHost;
  }
}

/**
 * Where a platform ref has to move to, when its host no longer serves the
 * project it names; `undefined` when it does not have to (or is not a
 * platform ref). `why` and `to` are for the caller's sentence: what can be
 * done about it differs by caller (a Studio **Fix**, `val validate --fix`, or
 * nothing yet).
 */
export async function movedRemoteHost(
  ref: string,
  ask?: AskHostProject,
): Promise<{ ref: string; why: string; to: string } | undefined> {
  const parsed = Internal.remote.splitRemoteRef(ref);
  if (
    parsed.status === "error" ||
    !needsHostCheck(parsed.remoteHost, parsed.projectId)
  ) {
    return undefined;
  }
  const serves = await hostServes(parsed.remoteHost, parsed.projectId, ask);
  // Only an answer that says so moves a ref: the host serves another
  // project, or the loader says it serves none (its 404 for a domain nobody
  // maps). A host that did not answer, or answered 5xx, may be down for a
  // minute -- and a moved ref does not move back, so rewriting on that would
  // take a site's images off its own domain for good over one blip. Those are
  // left to the existence check, which reports the host once with Try again.
  if (
    serves.status === "serves" ||
    serves.status === "unreachable" ||
    (serves.status === "no-site" && serves.httpStatus !== 404)
  ) {
    return undefined;
  }
  const target = fallbackRemoteHost(parsed.projectId);
  const moved = rewriteRefHost(ref, target);
  if (moved === null) {
    return undefined;
  }
  const from = hostNameOfRemoteHost(parsed.remoteHost);
  return {
    ref: moved,
    why:
      serves.status === "other-project"
        ? `${from} now serves another project, so this file is not shown from there`
        : `${from} no longer serves this project, so this file is not shown from there`,
    to: hostNameOfRemoteHost(target),
  };
}

/**
 * Where else a ref's file can be downloaded from: the same file on the
 * project's own `valstart.dev` address, for a platform ref on any other host.
 * `null` when there is nowhere else -- a `remote.val.build` ref, or one already
 * on the fallback. See valbuild/home `docs/remote-files-on-platform.md`,
 * "Tooling: the fallback".
 */
export function fallbackRefOf(ref: string): string | null {
  const parsed = Internal.remote.splitRemoteRef(ref);
  if (
    parsed.status === "error" ||
    !needsHostCheck(parsed.remoteHost, parsed.projectId)
  ) {
    return null;
  }
  return rewriteRefHost(ref, fallbackRemoteHost(parsed.projectId));
}
