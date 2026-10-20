import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { urlOf } from "@valbuild/shared/internal";
import { Button } from "../designSystem/button";
import {
  StudioPublishError,
  callJson,
  createStudioPublishClient,
  isTransientPublishError,
} from "../../publish/publishClient";
import {
  lockedPackages,
  typescriptVersion,
  type Locked,
} from "../../typecheck/lockedVersions";

export { lockedPackages, typescriptVersion };

/**
 * `/val/adept`: adept, tried out on this project (`VAL_ADEPT_ROUTE`).
 *
 * Linked from nowhere. It asks content's `/adept/*` routes, through this
 * deployment's publish proxy, for what the Upgrade button will need: a
 * lockfile for the live site's package.json, each kind of upgrade from it,
 * and the type bundles and compiler a typecheck would load. It shows what
 * came back and how long it took, and changes nothing: nothing it computes
 * is staged or published.
 */

const API = "/api/val";
const proxy = `${API}/publish-api`;

type Files = Record<string, string>;

/**
 * What went wrong, by what the person can do about it: sign in again, fix
 * what they typed, or -- for adept's own answers and the rest -- try again
 * when that can help, and only then.
 */
type Failure =
  | { kind: "signed-out" }
  | { kind: "input"; message: string }
  | { kind: "error"; code: string; message: string; retryable: boolean };

/** Something typed on this page that is not what it accepts. */
class InputError extends Error {}

/** An answer that is not what this page expects: asking again gets the same one. */
class UnexpectedAnswer extends Error {}

/** The page left, or the same work started again: nobody is waiting for this any more. */
export class Abandoned extends Error {}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isFiles(value: unknown): value is Files {
  return (
    isRecord(value) && Object.values(value).every((v) => typeof v === "string")
  );
}

/** adept's `{ error: { code, message, retryable } }`, or what else failed. */
export function failureOf(error: unknown): Failure {
  if (error instanceof InputError) {
    return { kind: "input", message: error.message };
  }
  if (error instanceof UnexpectedAnswer) {
    return {
      kind: "error",
      code: "unexpected-answer",
      message: error.message,
      retryable: false,
    };
  }
  if (error instanceof StudioPublishError) {
    if (error.statusCode === 401) return { kind: "signed-out" };
    const body = isRecord(error.body) ? error.body["error"] : undefined;
    if (isRecord(body) && typeof body["message"] === "string") {
      return {
        kind: "error",
        code: typeof body["code"] === "string" ? body["code"] : "error",
        message: body["message"],
        retryable: body["retryable"] === true,
      };
    }
    return {
      kind: "error",
      code: String(error.statusCode),
      message: error.message,
      // 501 is a deployment with no content service to ask: asking again
      // gets the same answer.
      retryable: error.statusCode !== 501 && isTransientPublishError(error),
    };
  }
  return {
    kind: "error",
    code: "network",
    message: error instanceof Error ? error.message : String(error),
    retryable: true,
  };
}

/** Waits, unless the work is abandoned first. */
function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) return reject(new Abandoned());
    const timer = setTimeout(() => {
      signal.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      reject(new Abandoned());
    };
    signal.addEventListener("abort", onAbort, { once: true });
  });
}

type JobAnswer = {
  id: number | null;
  state: string;
  step: string | null;
  error: string | null;
  body: Record<string, unknown>;
};

function jobAnswer(value: unknown): JobAnswer {
  if (!isRecord(value) || typeof value["state"] !== "string") {
    throw new UnexpectedAnswer(
      "adept answered with something that is not a job.",
    );
  }
  return {
    id: typeof value["id"] === "number" ? value["id"] : null,
    state: value["state"],
    step: typeof value["step"] === "string" ? value["step"] : null,
    error: typeof value["error"] === "string" ? value["error"] : null,
    body: value,
  };
}

/** How long a job is polled before the page stops waiting for it. */
const JOB_DEADLINE_MS = 15 * 60 * 1000;

/**
 * A lockfile or upgrade job: content waits up to 20 s and then answers with
 * the job, which is polled until it is done. Returns the job's result.
 *
 * Stops when `signal` aborts (the page left, or the work started again),
 * after `JOB_DEADLINE_MS`, and on any state that is not still going -- a
 * state it does not know is not one to wait out.
 */
export async function runJob(
  path: "/adept/lockfile" | "/adept/upgrade",
  body: unknown,
  onProgress: (step: string) => void,
  signal: AbortSignal,
): Promise<Record<string, unknown>> {
  let answer = jobAnswer(
    await callJson(fetch, `${proxy}${path}`, "POST", body),
  );
  if (answer.state === "done") return answer.body;
  const id = answer.id;
  if (id === null) {
    throw new UnexpectedAnswer("adept answered with a job that has no id.");
  }
  const deadline = Date.now() + JOB_DEADLINE_MS;
  for (;;) {
    if (answer.state === "failed" || answer.state === "cancelled") {
      throw new StudioPublishError(422, answer.error ?? answer.state, {
        error: {
          code: answer.state,
          message: answer.error ?? `The job was ${answer.state}.`,
          retryable: false,
        },
      });
    }
    if (answer.state !== "queued" && answer.state !== "running") {
      throw new UnexpectedAnswer(`adept says the job is '${answer.state}'.`);
    }
    if (Date.now() > deadline) {
      throw new StudioPublishError(504, "The job took too long.", {
        error: {
          code: "too-slow",
          message: `adept had not finished after ${JOB_DEADLINE_MS / 60000} minutes, so the page stopped waiting.`,
          retryable: true,
        },
      });
    }
    onProgress(answer.step ?? answer.state);
    await sleep(1000, signal);
    answer = jobAnswer(
      await callJson(fetch, `${proxy}/adept/jobs/${id}`, "GET"),
    );
    if (answer.state === "done") {
      const result = await callJson(
        fetch,
        `${proxy}/adept/jobs/${id}/result`,
        "GET",
      );
      if (!isRecord(result)) {
        throw new UnexpectedAnswer("adept's job finished without a result.");
      }
      return result;
    }
  }
}

function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="flex flex-col gap-3 border-b border-border-primary pb-6">
      <h2 className="text-lg font-semibold">{title}</h2>
      {children}
    </section>
  );
}

function FailureNote({
  failure,
  onRetry,
}: {
  failure: Failure;
  onRetry?: () => void;
}) {
  if (failure.kind === "signed-out") {
    return (
      <div className="flex flex-col gap-2 rounded bg-bg-error-primary p-3 text-sm text-fg-error-on-surface">
        <div>You are signed out, so this project cannot be asked.</div>
        <div>
          <Button size="sm" variant="outline" asChild>
            <a
              href={urlOf("/api/val/authorize", {
                redirect_to: window.location.href,
              })}
            >
              Sign in
            </a>
          </Button>
        </div>
      </div>
    );
  }
  // An input error is shown at its field, not here.
  if (failure.kind === "input") return null;
  return (
    <div className="flex flex-col gap-2 rounded bg-bg-error-primary p-3 text-sm text-fg-error-on-surface">
      <div>
        <code className="font-mono">{failure.code}</code>: {failure.message}
      </div>
      {failure.retryable && onRetry && (
        <div>
          <Button size="sm" variant="outline" onClick={onRetry}>
            Try again
          </Button>
        </div>
      )}
    </div>
  );
}

type Timed<T> =
  | { status: "idle" }
  | { status: "running"; step?: string }
  | { status: "done"; value: T; ms: number }
  | { status: "failed"; failure: Failure };

type Work<T> = (
  progress: (step: string) => void,
  signal: AbortSignal,
) => Promise<T>;

/**
 * One piece of work at a time, timed. Starting it again abandons the run
 * before, and so does leaving the page: an abandoned run polls no further
 * and changes no state.
 */
function useTimed<T>(): [Timed<T>, (work: Work<T>) => Promise<void>] {
  const [state, setState] = useState<Timed<T>>({ status: "idle" });
  const current = useRef<AbortController | null>(null);
  useEffect(() => () => current.current?.abort(), []);
  const run = useCallback(async (work: Work<T>) => {
    current.current?.abort();
    const controller = new AbortController();
    current.current = controller;
    const live = () => !controller.signal.aborted;
    const started = performance.now();
    setState({ status: "running" });
    try {
      const value = await work(
        (step) => live() && setState({ status: "running", step }),
        controller.signal,
      );
      if (live()) {
        setState({ status: "done", value, ms: performance.now() - started });
      }
    } catch (error) {
      if (live() && !(error instanceof Abandoned)) {
        setState({ status: "failed", failure: failureOf(error) });
      }
    }
  }, []);
  return [state, run];
}

const seconds = (ms: number) => `${(ms / 1000).toFixed(1)} s`;
const kilobytes = (n: number) => `${Math.round(n / 1024).toLocaleString()} kB`;

export function AdeptView() {
  const [source, setSource] = useState<
    | { status: "loading" }
    | { status: "none" }
    | { status: "loaded"; files: Files }
    | { status: "failed"; failure: Failure }
  >({ status: "loading" });
  const unmounted = useRef(false);
  useEffect(
    () => () => {
      unmounted.current = true;
    },
    [],
  );
  const loadSource = useCallback(() => {
    setSource({ status: "loading" });
    createStudioPublishClient({ api: API })
      .projectSource()
      .then(
        (files) =>
          !unmounted.current &&
          setSource(files ? { status: "loaded", files } : { status: "none" }),
      )
      .catch(
        (error) =>
          !unmounted.current &&
          setSource({ status: "failed", failure: failureOf(error) }),
      );
  }, []);
  useEffect(loadSource, [loadSource]);

  const packageJson =
    source.status === "loaded" ? source.files["package.json"] : undefined;

  const [lock, runLock] = useTimed<{ lockfile: string; cached: unknown }>();
  const computeLockfile = () =>
    runLock(async (progress, signal) => {
      const result = await runJob(
        "/adept/lockfile",
        { files: { "package.json": packageJson } },
        progress,
        signal,
      );
      const changed = result["changed"];
      const lockfile =
        typeof result["lockfile"] === "string"
          ? result["lockfile"]
          : isFiles(changed)
            ? changed["pnpm-lock.yaml"]
            : undefined;
      if (!lockfile) {
        throw new UnexpectedAnswer("adept answered without a lockfile.");
      }
      return { lockfile, cached: result["cached"] };
    });
  const lockfile = lock.status === "done" ? lock.value.lockfile : null;
  const packages = useMemo(
    () => (lockfile ? lockedPackages(lockfile) : []),
    [lockfile],
  );

  return (
    <div className="flex flex-col gap-6 p-6 text-sm">
      <div className="flex flex-col gap-1">
        <h1 className="text-xl font-semibold">adept</h1>
        <p className="text-fg-secondary">
          Lockfiles, upgrades and type bundles for this project, computed by
          adept and shown here. Nothing on this page is staged or published.
        </p>
      </div>

      <Section title="The live site's package.json">
        {source.status === "loading" && <div>Reading the live site…</div>}
        {source.status === "none" && (
          <div>
            This project has never been published, so there is nothing to read.
          </div>
        )}
        {source.status === "failed" && (
          <FailureNote failure={source.failure} onRetry={loadSource} />
        )}
        {source.status === "loaded" && !packageJson && (
          <div>The live site has no package.json.</div>
        )}
        {packageJson && (
          <details>
            <summary className="cursor-pointer">
              package.json ({kilobytes(packageJson.length)})
            </summary>
            <pre className="mt-2 max-h-96 overflow-auto rounded bg-bg-secondary p-3 font-mono text-xs">
              {packageJson}
            </pre>
          </details>
        )}
      </Section>

      <Section title="1. Lockfile">
        <p className="text-fg-secondary">
          The live site keeps no lockfile, so this resolves one from
          package.json, as <code>pnpm install --lockfile-only</code> would.
        </p>
        <div>
          <Button
            disabled={!packageJson || lock.status === "running"}
            onClick={computeLockfile}
          >
            {lock.status === "running" ? "Resolving…" : "Compute the lockfile"}
          </Button>
        </div>
        {lock.status === "running" && lock.step && <div>{lock.step}</div>}
        {lock.status === "failed" && (
          <FailureNote failure={lock.failure} onRetry={computeLockfile} />
        )}
        {lock.status === "done" && (
          <>
            <div>
              {kilobytes(lock.value.lockfile.length)}, {packages.length}{" "}
              packages, in {seconds(lock.ms)}
              {lock.value.cached
                ? ` (from adept's cache: ${String(lock.value.cached)})`
                : ""}
            </div>
            <details>
              <summary className="cursor-pointer">pnpm-lock.yaml</summary>
              <pre className="mt-2 max-h-96 overflow-auto rounded bg-bg-secondary p-3 font-mono text-xs">
                {lock.value.lockfile}
              </pre>
            </details>
          </>
        )}
      </Section>

      {packageJson && lockfile && (
        <UpgradeSection packageJson={packageJson} lockfile={lockfile} />
      )}
      {lockfile && <TypesSection lockfile={lockfile} packages={packages} />}
    </div>
  );
}

type Moved = {
  importer: string;
  name: string;
  fromVersion: string | null;
  toVersion: string | null;
  kind: string | null;
};

/** What this page shows of an upgrade's candidate. */
type Candidate = {
  changed: Files;
  steps: string[];
  direct: Moved[];
  vulnerableBefore: number | null;
  vulnerableAfter: number | null;
  cached: unknown;
};

const stringOr = (value: unknown): string | null =>
  typeof value === "string" ? value : null;

function findingsOf(audit: unknown): number | null {
  if (!isRecord(audit) || !Array.isArray(audit["findings"])) return null;
  return audit["findings"].length;
}

function candidateOf(result: Record<string, unknown>): Candidate {
  const changes = result["changes"];
  const direct =
    isRecord(changes) && Array.isArray(changes["direct"])
      ? changes["direct"]
      : [];
  const steps = result["steps"];
  return {
    changed: isFiles(result["changed"]) ? result["changed"] : {},
    steps: Array.isArray(steps)
      ? steps.filter((step): step is string => typeof step === "string")
      : [],
    direct: direct.filter(isRecord).map(
      (d): Moved => ({
        importer: stringOr(d["importer"]) ?? "",
        name: stringOr(d["name"]) ?? "",
        fromVersion: stringOr(d["fromVersion"]),
        toVersion: stringOr(d["toVersion"]),
        kind: stringOr(d["kind"]),
      }),
    ),
    vulnerableBefore: findingsOf(result["auditBefore"]),
    vulnerableAfter: findingsOf(result["auditAfter"]),
    cached: result["cached"],
  };
}

type UpgradePath = "cves" | "latest" | "majors" | "set";
const PATH_ORDER: UpgradePath[] = ["cves", "latest", "majors", "set"];
const PATHS: Record<UpgradePath, string> = {
  cves: "Fix vulnerabilities",
  latest: "Latest in the same major",
  majors: "Latest, across majors",
  set: "Onto exact versions",
};

const SET_SHAPE = '{ "name": "1.2.3" }';

/** The versions typed for path `set`, or an `InputError` saying what is accepted. */
export function setVersionsOf(text: string): Record<string, string> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new InputError(`Not JSON. Write the versions as ${SET_SHAPE}.`);
  }
  if (!isFiles(parsed) || Object.keys(parsed).length === 0) {
    throw new InputError(
      `Name each package and its exact version, as ${SET_SHAPE}.`,
    );
  }
  return parsed;
}

function UpgradeSection({
  packageJson,
  lockfile,
}: {
  packageJson: string;
  lockfile: string;
}) {
  const [path, setPath] = useState<UpgradePath>("latest");
  const [setText, setSetText] = useState(
    '{\n  "react": "19.1.0",\n  "react-dom": "19.1.0"\n}',
  );
  const setField = useRef<HTMLTextAreaElement>(null);
  const [upgrade, runUpgrade] = useTimed<Candidate>();
  const start = () =>
    runUpgrade(async (progress, signal) => {
      const body: Record<string, unknown> = {
        files: { "package.json": packageJson, "pnpm-lock.yaml": lockfile },
        path,
      };
      if (path === "set") body["set"] = setVersionsOf(setText);
      return candidateOf(
        await runJob("/adept/upgrade", body, progress, signal),
      );
    });
  const inputError =
    upgrade.status === "failed" && upgrade.failure.kind === "input"
      ? upgrade.failure.message
      : null;
  // Focus goes to what has to be fixed.
  useEffect(() => {
    if (inputError !== null) setField.current?.focus();
  }, [inputError]);
  const direct = upgrade.status === "done" ? upgrade.value.direct : [];
  const moved = direct.filter((d) => d.fromVersion !== d.toVersion);
  return (
    <Section title="2. Upgrade">
      <div className="flex flex-wrap gap-2">
        {PATH_ORDER.map((key) => (
          <Button
            key={key}
            size="sm"
            variant={path === key ? "default" : "outline"}
            onClick={() => setPath(key)}
          >
            {PATHS[key]}
          </Button>
        ))}
      </div>
      {path === "set" && (
        <div className="flex flex-col gap-1">
          <label htmlFor="adept-set" className="text-fg-secondary">
            Each package and the exact version to move it to, as {SET_SHAPE}
          </label>
          <textarea
            id="adept-set"
            ref={setField}
            aria-invalid={inputError !== null}
            aria-describedby={
              inputError !== null ? "adept-set-error" : undefined
            }
            className={
              "h-28 rounded border bg-bg-primary p-2 font-mono text-xs " +
              (inputError !== null
                ? "border-border-error-primary"
                : "border-border-primary")
            }
            value={setText}
            onChange={(event) => setSetText(event.target.value)}
          />
          {inputError !== null && (
            <p
              id="adept-set-error"
              role="alert"
              className="text-xs text-fg-error-primary"
            >
              {inputError}
            </p>
          )}
        </div>
      )}
      <div>
        <Button disabled={upgrade.status === "running"} onClick={start}>
          {upgrade.status === "running"
            ? "Computing…"
            : `Compute: ${PATHS[path]}`}
        </Button>
      </div>
      {upgrade.status === "running" && upgrade.step && (
        <div>{upgrade.step}</div>
      )}
      {upgrade.status === "failed" && (
        <FailureNote failure={upgrade.failure} onRetry={start} />
      )}
      {upgrade.status === "done" && (
        <div className="flex flex-col gap-3">
          <div>
            {seconds(upgrade.ms)}
            {upgrade.value.cached
              ? ` (from adept's cache: ${String(upgrade.value.cached)})`
              : ""}
            . Vulnerable packages: {upgrade.value.vulnerableBefore ?? "–"}{" "}
            before, {upgrade.value.vulnerableAfter ?? "–"} after. Files changed:{" "}
            {Object.keys(upgrade.value.changed).join(", ") || "none"}.
          </div>
          {moved.length > 0 ? (
            <table className="w-fit border-collapse text-xs">
              <thead>
                <tr className="text-left">
                  <th className="pr-4">Package</th>
                  <th className="pr-4">From</th>
                  <th className="pr-4">To</th>
                  <th>Kind</th>
                </tr>
              </thead>
              <tbody>
                {moved.map((d) => (
                  <tr key={`${d.importer}\0${d.name}`}>
                    <td className="pr-4 font-mono">{d.name}</td>
                    <td className="pr-4 font-mono">{d.fromVersion ?? "–"}</td>
                    <td className="pr-4 font-mono">{d.toVersion ?? "–"}</td>
                    <td>{d.kind ?? ""}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <div>No direct dependency moves to another version.</div>
          )}
          {direct.length > moved.length && (
            <div className="text-fg-secondary">
              {direct.length - moved.length} more only had their range raised to
              the version already locked.
            </div>
          )}
          {upgrade.value.steps.length > 0 && (
            <div className="text-fg-secondary">
              Steps: {upgrade.value.steps.join(" → ")}
            </div>
          )}
          {Object.entries(upgrade.value.changed).map(([file, text]) => (
            <details key={file}>
              <summary className="cursor-pointer">{file}</summary>
              <pre className="mt-2 max-h-96 overflow-auto rounded bg-bg-secondary p-3 font-mono text-xs">
                {text}
              </pre>
            </details>
          ))}
        </div>
      )}
    </Section>
  );
}

type Fetched = {
  name: string;
  version: string;
  ms: number;
  files?: number;
  stubs?: number;
  bytes?: number;
  failure?: Failure;
};

const CONCURRENCY = 6;

/** One line for a failure in a list, where there is no room for its action. */
function describeFailure(failure: Failure | undefined): string {
  if (failure === undefined) return "";
  if (failure.kind === "signed-out") return "signed out";
  if (failure.kind === "input") return failure.message;
  return `${failure.code}: ${failure.message}`;
}

function TypesSection({
  lockfile,
  packages,
}: {
  lockfile: string;
  packages: Locked[];
}) {
  const [fetched, setFetched] = useState<Fetched[]>([]);
  const [running, setRunning] = useState(false);
  const [total, setTotal] = useState<number | null>(null);
  const current = useRef<AbortController | null>(null);
  useEffect(() => () => current.current?.abort(), []);
  const fetchAll = async () => {
    current.current?.abort();
    const controller = new AbortController();
    current.current = controller;
    const live = () => !controller.signal.aborted;
    setRunning(true);
    setFetched([]);
    setTotal(null);
    const started = performance.now();
    const queue = [...packages];
    const one = async (p: Locked): Promise<Fetched> => {
      const t = performance.now();
      try {
        const answer = await callJson(
          fetch,
          `${proxy}/adept/types/public/${p.name}@${p.version}`,
          "GET",
        );
        if (!isRecord(answer) || !isFiles(answer["files"])) {
          throw new UnexpectedAnswer("adept answered without a bundle.");
        }
        const files = answer["files"];
        const stubs = answer["stubs"];
        return {
          ...p,
          ms: performance.now() - t,
          files: Object.keys(files).length,
          stubs: Array.isArray(stubs) ? stubs.length : 0,
          bytes: Object.values(files).reduce((n, text) => n + text.length, 0),
        };
      } catch (error) {
        return { ...p, ms: performance.now() - t, failure: failureOf(error) };
      }
    };
    await Promise.all(
      Array.from({ length: CONCURRENCY }, async () => {
        for (let p = queue.shift(); p && live(); p = queue.shift()) {
          const result = await one(p);
          if (live()) setFetched((all) => [...all, result]);
        }
      }),
    );
    if (live()) {
      setTotal(performance.now() - started);
      setRunning(false);
    }
  };
  const failed = fetched.filter((f) => f.failure);
  const ok = fetched.filter((f) => !f.failure);
  const slowest = [...ok].sort((a, b) => b.ms - a.ms).slice(0, 5);
  const typescript = typescriptVersion(lockfile);
  const [compiler, runCompiler] = useTimed<{ files: number; bytes: number }>();
  const loadCompiler = () =>
    runCompiler(async () => {
      const answer = await callJson(
        fetch,
        `${proxy}/adept/compiler/${typescript}`,
        "GET",
      );
      if (!isRecord(answer) || !isFiles(answer["files"])) {
        throw new UnexpectedAnswer(
          "adept answered without the compiler's files.",
        );
      }
      const files = answer["files"];
      return {
        files: Object.keys(files).length,
        bytes: Object.values(files).reduce((n, t) => n + t.length, 0),
      };
    });
  return (
    <Section title="3. Types and the compiler">
      <p className="text-fg-secondary">
        What a typecheck in the browser would load: a bundle per package version
        in the lockfile, and the project&apos;s own TypeScript. A real check
        fetches only what the imports reach; this fetches every package, to see
        how all of them do.
      </p>
      <div className="flex flex-wrap gap-2">
        <Button disabled={running} onClick={fetchAll}>
          {running
            ? `Fetching… ${fetched.length} of ${packages.length}`
            : `Fetch the types of all ${packages.length} packages`}
        </Button>
        <Button
          variant="outline"
          disabled={!typescript || compiler.status === "running"}
          onClick={loadCompiler}
        >
          {typescript
            ? `Fetch TypeScript ${typescript}'s compiler`
            : "The lockfile names no TypeScript"}
        </Button>
      </div>
      {fetched.length > 0 && (
        <div>
          {ok.length} bundles,{" "}
          {ok.reduce((n, f) => n + (f.files ?? 0), 0).toLocaleString()} files
          and {ok.reduce((n, f) => n + (f.stubs ?? 0), 0).toLocaleString()}{" "}
          stubs, {kilobytes(ok.reduce((n, f) => n + (f.bytes ?? 0), 0))}{" "}
          unpacked
          {total !== null
            ? `, in ${seconds(total)} with ${CONCURRENCY} at a time`
            : ""}
          .{failed.length > 0 && ` ${failed.length} failed.`}
        </div>
      )}
      {slowest.length > 0 && !running && (
        <div className="text-fg-secondary">
          Slowest:{" "}
          {slowest
            .map((f) => `${f.name}@${f.version} ${seconds(f.ms)}`)
            .join(", ")}
        </div>
      )}
      {failed.map((f) => (
        <div key={`${f.name}@${f.version}`} className="font-mono text-xs">
          {f.name}@{f.version}: {describeFailure(f.failure)}
        </div>
      ))}
      {compiler.status === "failed" && (
        <FailureNote failure={compiler.failure} onRetry={loadCompiler} />
      )}
      {compiler.status === "done" && (
        <div>
          TypeScript {typescript}: {compiler.value.files} files,{" "}
          {kilobytes(compiler.value.bytes)}, in {seconds(compiler.ms)}.
        </div>
      )}
    </Section>
  );
}
