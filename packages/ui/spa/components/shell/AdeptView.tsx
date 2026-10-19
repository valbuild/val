import { useCallback, useEffect, useMemo, useState } from "react";
import { Button } from "../designSystem/button";
import {
  StudioPublishError,
  callJson,
  createStudioPublishClient,
} from "../../publish/publishClient";

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
type Failure = { code: string; message: string; retryable: boolean };

/** adept's `{ error: { code, message, retryable } }`, or what else failed. */
function failureOf(error: unknown): Failure {
  if (error instanceof StudioPublishError) {
    const body = error.body as {
      error?: { code?: unknown; message?: unknown; retryable?: unknown };
    } | null;
    if (body?.error && typeof body.error.message === "string") {
      return {
        code: typeof body.error.code === "string" ? body.error.code : "error",
        message: body.error.message,
        retryable: body.error.retryable === true,
      };
    }
    return {
      code: String(error.statusCode),
      message: error.message,
      retryable: error.statusCode >= 500,
    };
  }
  return {
    code: "network",
    message: error instanceof Error ? error.message : String(error),
    retryable: true,
  };
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * A lockfile or upgrade job: content waits up to 20 s and then answers with
 * the job, which is polled until it is done. Returns the job's result.
 */
async function runJob(
  path: "/adept/lockfile" | "/adept/upgrade",
  body: unknown,
  onProgress: (step: string) => void,
): Promise<Record<string, unknown>> {
  let answer = (await callJson(fetch, `${proxy}${path}`, "POST", body)) as {
    id: number;
    state: string;
    step?: string;
    error?: string;
  } & Record<string, unknown>;
  if (answer.state === "done") return answer;
  const id = answer.id;
  for (;;) {
    onProgress(answer.step ?? answer.state);
    await sleep(1000);
    answer = (await callJson(
      fetch,
      `${proxy}/adept/jobs/${id}`,
      "GET",
    )) as typeof answer;
    if (answer.state === "done") {
      return (await callJson(
        fetch,
        `${proxy}/adept/jobs/${id}/result`,
        "GET",
      )) as Record<string, unknown>;
    }
    if (answer.state === "failed" || answer.state === "cancelled") {
      throw new StudioPublishError(422, answer.error ?? answer.state, {
        error: {
          code: answer.state,
          message: answer.error ?? `The job was ${answer.state}.`,
          retryable: false,
        },
      });
    }
  }
}

type Locked = { name: string; version: string; integrity?: string };

/** The registry packages a pnpm 9 lockfile's `packages:` section names. */
export function lockedPackages(lockfile: string): Locked[] {
  const out: Locked[] = [];
  let inPackages = false;
  let current: Locked | null = null;
  for (const line of lockfile.split("\n")) {
    if (/^\S/.test(line)) {
      inPackages = line.startsWith("packages:");
      current = null;
      continue;
    }
    if (!inPackages) continue;
    const head = /^ {2}['"]?(.+?)['"]?:\s*$/.exec(line);
    if (head) {
      const key = head[1]!;
      const at = key.lastIndexOf("@");
      const version = key.slice(at + 1);
      current = null;
      if (at > 0 && /^\d+\.\d+\.\d+/.test(version)) {
        current = { name: key.slice(0, at), version };
        out.push(current);
      }
      continue;
    }
    const integrity = /integrity: (sha512-[^,}\s]+)/.exec(line);
    if (current && integrity) current.integrity = integrity[1];
  }
  return out;
}

/** The version the root importer's lockfile entry gives `typescript`. */
export function typescriptVersion(lockfile: string): string | null {
  const start = lockfile.indexOf("\n  .:\n");
  if (start < 0) return null;
  const end = lockfile.indexOf("\n\n", start + 1);
  const root = lockfile.slice(start, end < 0 ? undefined : end);
  return (
    /\n {6}typescript:\n {8}specifier: [^\n]+\n {8}version: (\d+\.\d+\.\d+[^\s(]*)/.exec(
      root,
    )?.[1] ?? null
  );
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

function useTimed<T>() {
  const [state, setState] = useState<Timed<T>>({ status: "idle" });
  const run = useCallback(
    async (work: (progress: (step: string) => void) => Promise<T>) => {
      const started = performance.now();
      setState({ status: "running" });
      try {
        const value = await work((step) =>
          setState({ status: "running", step }),
        );
        setState({ status: "done", value, ms: performance.now() - started });
      } catch (error) {
        setState({ status: "failed", failure: failureOf(error) });
      }
    },
    [],
  );
  return [state, run] as const;
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
  const loadSource = useCallback(() => {
    setSource({ status: "loading" });
    createStudioPublishClient({ api: API })
      .projectSource()
      .then((files) =>
        setSource(files ? { status: "loaded", files } : { status: "none" }),
      )
      .catch((error) =>
        setSource({ status: "failed", failure: failureOf(error) }),
      );
  }, []);
  useEffect(loadSource, [loadSource]);

  const packageJson =
    source.status === "loaded" ? source.files["package.json"] : undefined;

  const [lock, runLock] = useTimed<{ lockfile: string; cached: unknown }>();
  const computeLockfile = () =>
    runLock(async (progress) => {
      const result = await runJob(
        "/adept/lockfile",
        { files: { "package.json": packageJson } },
        progress,
      );
      const changed = result["changed"] as Files | undefined;
      const lockfile =
        (result["lockfile"] as string | undefined) ??
        changed?.["pnpm-lock.yaml"];
      if (!lockfile) throw new Error("adept answered without a lockfile.");
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

type Candidate = {
  changed?: Files;
  steps?: string[];
  changes?: {
    direct?: Array<{
      importer: string;
      name: string;
      fromSpecifier?: string;
      toSpecifier?: string;
      fromVersion?: string;
      toVersion?: string;
      kind?: string;
    }>;
  };
  auditBefore?: { findings?: unknown[] } | null;
  auditAfter?: { findings?: unknown[] } | null;
  proposals?: Array<{
    key: string;
    name: string;
    from: string;
    to: string;
    kind: string;
  }>;
  cached?: unknown;
};

const PATHS = {
  cves: "Fix vulnerabilities",
  latest: "Latest in the same major",
  majors: "Latest, across majors",
  set: "Onto exact versions",
} as const;

function UpgradeSection({
  packageJson,
  lockfile,
}: {
  packageJson: string;
  lockfile: string;
}) {
  const [path, setPath] = useState<keyof typeof PATHS>("latest");
  const [setText, setSetText] = useState(
    '{\n  "react": "19.1.0",\n  "react-dom": "19.1.0"\n}',
  );
  const [upgrade, runUpgrade] = useTimed<Candidate>();
  const start = () =>
    runUpgrade(async (progress) => {
      const body: Record<string, unknown> = {
        files: { "package.json": packageJson, "pnpm-lock.yaml": lockfile },
        path,
      };
      if (path === "set") {
        try {
          body["set"] = JSON.parse(setText);
        } catch {
          throw new Error('The versions are not JSON: { "name": "1.2.3" }.');
        }
      }
      return (await runJob("/adept/upgrade", body, progress)) as Candidate;
    });
  const direct =
    (upgrade.status === "done" && upgrade.value.changes?.direct) || [];
  const moved = direct.filter((d) => d.fromVersion !== d.toVersion);
  return (
    <Section title="2. Upgrade">
      <div className="flex flex-wrap gap-2">
        {(Object.keys(PATHS) as Array<keyof typeof PATHS>).map((key) => (
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
        <textarea
          className="h-28 rounded border border-border-primary bg-bg-primary p-2 font-mono text-xs"
          value={setText}
          onChange={(event) => setSetText(event.target.value)}
        />
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
            . Vulnerable packages:{" "}
            {upgrade.value.auditBefore?.findings?.length ?? "–"} before,{" "}
            {upgrade.value.auditAfter?.findings?.length ?? "–"} after. Files
            changed:{" "}
            {Object.keys(upgrade.value.changed ?? {}).join(", ") || "none"}.
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
          {upgrade.value.steps && (
            <div className="text-fg-secondary">
              Steps: {upgrade.value.steps.join(" → ")}
            </div>
          )}
          {Object.entries(upgrade.value.changed ?? {}).map(([file, text]) => (
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
  const fetchAll = async () => {
    setRunning(true);
    setFetched([]);
    const started = performance.now();
    const queue = [...packages];
    const one = async (p: Locked): Promise<Fetched> => {
      const t = performance.now();
      try {
        const res = await fetch(
          `${proxy}/adept/types/public/${p.name}@${p.version}`,
          { credentials: "same-origin" },
        );
        const text = await res.text();
        const json = JSON.parse(text) as {
          files?: Record<string, string>;
          stubs?: string[];
        };
        if (!res.ok) {
          throw new StudioPublishError(res.status, `HTTP ${res.status}`, json);
        }
        return {
          ...p,
          ms: performance.now() - t,
          files: Object.keys(json.files ?? {}).length,
          stubs: json.stubs?.length ?? 0,
          bytes: text.length,
        };
      } catch (error) {
        return { ...p, ms: performance.now() - t, failure: failureOf(error) };
      }
    };
    await Promise.all(
      Array.from({ length: CONCURRENCY }, async () => {
        for (let p = queue.shift(); p; p = queue.shift()) {
          const result = await one(p);
          setFetched((all) => [...all, result]);
        }
      }),
    );
    setTotal(performance.now() - started);
    setRunning(false);
  };
  const failed = fetched.filter((f) => f.failure);
  const ok = fetched.filter((f) => !f.failure);
  const slowest = [...ok].sort((a, b) => b.ms - a.ms).slice(0, 5);
  const typescript = typescriptVersion(lockfile);
  const [compiler, runCompiler] = useTimed<{ files: number; bytes: number }>();
  const loadCompiler = () =>
    runCompiler(async () => {
      const answer = (await callJson(
        fetch,
        `${proxy}/adept/compiler/${typescript}`,
        "GET",
      )) as { files?: Record<string, string> };
      const files = answer.files ?? {};
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
          {f.name}@{f.version}: {f.failure!.code}: {f.failure!.message}
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
