import { useCallback, useEffect, useRef, useState } from "react";
import { Check, ChevronDown, ChevronRight, Copy } from "lucide-react";
import { cn } from "../designSystem/cn";
import { copyText } from "../../utils/copyText";
import { ShellServerVersions, ShellVersions } from "./types";

const FRAMEWORK_LABEL: Record<"next" | "tanstack", string> = {
  next: "Next.js",
  tanstack: "TanStack",
};

type ServerState = { status: "loading" } | ShellServerVersions;

type Row = { name: string; version: string };

/**
 * The versions of Val's packages, at the very foot of the account panel.
 *
 * Deliberately quiet: one grey line, which opens into the list. It is there
 * for the one moment someone is asked "which version are you on?", and
 * otherwise it should not be noticed.
 *
 * Two halves, because they are two different installs that can disagree: what
 * the SERVER runs (the framework binding, core and server, from the app's
 * `node_modules`) and what this TAB loaded (`@valbuild/ui`, and the core
 * bundled into it). The packages are linked rather than fixed in changesets,
 * so different numbers are normal and nothing here calls them a mismatch.
 *
 * The server is asked when the panel opens, which is rarely: nothing is added
 * to the polling the Studio already does.
 */
export function VersionList({
  versions,
  mode,
}: {
  versions: ShellVersions;
  mode?: "fs" | "http" | "unknown";
}) {
  const [open, setOpen] = useState(false);
  const [server, setServer] = useState<ServerState>({ status: "loading" });
  const [copied, setCopied] = useState(false);
  const { loadServer } = versions;

  // Which load is current, so a reply that lands after a retry (or after the
  // panel closed) cannot overwrite a newer answer.
  const loadId = useRef(0);
  const load = useCallback(() => {
    const id = ++loadId.current;
    setServer({ status: "loading" });
    loadServer().then(
      (res) => {
        if (loadId.current === id) setServer(res);
      },
      (err: unknown) => {
        if (loadId.current === id) {
          setServer({
            status: "error",
            message: err instanceof Error ? err.message : String(err),
          });
        }
      },
    );
  }, [loadServer]);
  useEffect(() => {
    load();
    return () => {
      loadId.current++;
    };
  }, [load]);

  useEffect(() => {
    if (!copied) return;
    const timeout = setTimeout(() => setCopied(false), 1500);
    return () => clearTimeout(timeout);
  }, [copied]);

  const serverRows: Row[] =
    server.status === "success"
      ? [
          ...(server.framework
            ? [
                {
                  name: `@valbuild/${server.framework.name}`,
                  version: server.framework.version,
                },
              ]
            : []),
          { name: "@valbuild/core", version: server.core },
          { name: "@valbuild/server", version: server.server },
        ]
      : [];
  const studioRows: Row[] = [
    { name: "@valbuild/ui", version: versions.studio.ui },
    { name: "@valbuild/core", version: versions.studio.core },
  ];
  const modeLabel = mode === "fs" || mode === "http" ? `${mode} mode` : null;

  const summary =
    server.status === "success" && server.framework
      ? `${FRAMEWORK_LABEL[server.framework.name]} · Val ${server.framework.version}`
      : `Val ${versions.studio.ui}`;

  const onCopy = () => {
    const lines = [
      ...(server.status === "success"
        ? ["Server:", ...serverRows.map(rowText)]
        : ["Server: not known"]),
      "Studio:",
      ...studioRows.map(rowText),
      ...(modeLabel ? [`Mode: ${mode}`] : []),
    ];
    copyText(lines.join("\n"));
    setCopied(true);
  };

  return (
    <div className="px-4 pt-4">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((prev) => !prev)}
        className="flex items-center justify-between w-full -mx-1 px-1 py-0.5 rounded text-[0.6875rem] text-fg-secondary-alt hover:text-fg-secondary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-border-focus"
      >
        <span className="truncate">{summary}</span>
        {open ? (
          <ChevronDown size={11} className="shrink-0" />
        ) : (
          <ChevronRight size={11} className="shrink-0" />
        )}
      </button>
      {open && (
        <div className="mt-1.5 rounded-md border border-border-float bg-bg-float-raised px-2.5 py-2 font-mono text-[0.6875rem]">
          {server.status === "loading" && (
            <div className="text-fg-secondary-alt">Asking the server…</div>
          )}
          {server.status === "success" && <Rows rows={serverRows} />}
          {server.status === "unsupported" && (
            <div className="font-sans text-fg-secondary-alt">
              This server&apos;s Val is older than the Studio and does not
              report its versions.
            </div>
          )}
          {server.status === "error" && (
            <div className="font-sans text-fg-secondary-alt">
              <div className="flex items-center justify-between gap-2">
                <span>Could not get the server&apos;s versions.</span>
                <button
                  type="button"
                  onClick={load}
                  className="shrink-0 text-fg-primary underline underline-offset-2 hover:no-underline"
                >
                  Try again
                </button>
              </div>
              <details className="mt-1">
                <summary className="cursor-pointer">Details</summary>
                <div className="mt-1 font-mono break-words">
                  {server.message}
                </div>
              </details>
            </div>
          )}
          <div className="flex items-center gap-2 my-1.5 text-fg-secondary-alt font-sans">
            <span className="h-px flex-1 bg-border-float" />
            Studio
            <span className="h-px flex-1 bg-border-float" />
          </div>
          <Rows rows={studioRows} />
          <div className="flex items-center justify-between mt-2 font-sans text-fg-secondary-alt">
            <span>{modeLabel}</span>
            <button
              type="button"
              onClick={onCopy}
              className={cn(
                "inline-flex items-center gap-1 h-6 px-1.5 rounded hover:bg-bg-float hover:text-fg-primary",
                copied && "text-fg-primary",
              )}
            >
              {copied ? <Check size={11} /> : <Copy size={11} />}
              {copied ? "Copied" : "Copy all"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function Rows({ rows }: { rows: Row[] }) {
  return (
    <dl className="space-y-0.5">
      {rows.map((row) => (
        <div
          key={row.name}
          className="flex items-baseline justify-between gap-3"
        >
          <dt className="text-fg-secondary truncate">{row.name}</dt>
          <dd className="text-fg-primary shrink-0">{row.version}</dd>
        </div>
      ))}
    </dl>
  );
}

function rowText(row: Row): string {
  return `${row.name} ${row.version}`;
}
