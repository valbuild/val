import type { SketchpadT } from "@valbuild/shared/internal";
import { useCallback, useEffect, useRef, useState } from "react";
import { Sketchpad, type SketchpadAssistantStatus } from "./Sketchpad";
import type { SketchpadClient } from "./sketchpadClient";
import type { SketchpadListItem } from "./SketchpadList";
import { useSketchpadsSnapshot, type SketchpadsState } from "./SketchpadsState";
import { SketchpadWorkspace } from "./SketchpadWorkspace";
import { useShellBreakpoint } from "../shell/useShellBreakpoint";
import {
  SketchpadSaver,
  type SaverProblem,
  type SaverStatus,
} from "./sketchpadSaver";

/**
 * The Sketchpad as the Studio's shell shows it: the open sketchpad from the
 * server, saved as it is typed, beside a preview of the page it is about.
 *
 * Every save names the version it was typed on. A save the server refuses
 * because the sketchpad moved on -- the assistant wrote to it, or someone
 * else did -- shows the newest version and keeps what was typed here, one
 * press away, rather than throwing either away.
 */
export function ValSketchpad({
  state,
  client,
  sketchpads,
  onSendToAssistant,
  onOpenAssistant,
  pageOptions,
  currentProfileId,
}: {
  state: SketchpadsState;
  client: SketchpadClient;
  /** The project's sketchpads, for the list behind the title. */
  sketchpads: {
    items: SketchpadListItem[];
    refresh: () => void;
  };
  /** Opens the chat and asks it to read the sketchpad. Absent without one. */
  onSendToAssistant?: (sketchpad: SketchpadT) => void;
  /** Opens the chat. Absent without one. */
  onOpenAssistant?: () => void;
  pageOptions: string[];
  currentProfileId: string | null;
}) {
  const snapshot = useSketchpadsSnapshot(state);
  const id = snapshot.openId;
  const known = id !== null ? snapshot.byId[id] : undefined;
  const [loadError, setLoadError] = useState<string | null>(null);
  const [archivedId, setArchivedId] = useState<string | null>(null);

  // Fetched every time it is opened: what this tab has may be from before
  // someone else's change. What it has is shown meanwhile, and the newer
  // version takes its place unless something typed here is waiting.
  const hasKnown = useRef(false);
  hasKnown.current = known !== undefined;
  useEffect(() => {
    if (id === null) {
      return;
    }
    let cancelled = false;
    setLoadError(null);
    client.get(id).then((res) => {
      if (cancelled) {
        return;
      }
      if (res.status === "ok") {
        state.put(res.sketchpad);
      } else if (!hasKnown.current) {
        setLoadError(res.message);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [id, client, state]);

  useEffect(() => {
    if (known) {
      markSeen(known);
    }
  }, [known]);

  useEffect(() => {
    if (archivedId === null) {
      return;
    }
    const timer = setTimeout(() => setArchivedId(null), 8000);
    return () => clearTimeout(timer);
  }, [archivedId]);

  const change = useCallback(
    async (
      sketchpad: SketchpadT,
      patch: { page?: string | null; archived?: boolean },
    ) => {
      const res = await client.update({
        id: sketchpad.id,
        baseVersion: sketchpad.version,
        ...patch,
      });
      if (res.status === "ok" || res.status === "conflict") {
        state.put(res.sketchpad);
      }
      sketchpads.refresh();
      return res;
    },
    [client, state, sketchpads],
  );

  const archive = async (sketchpad: SketchpadT) => {
    const res = await change(sketchpad, { archived: true });
    if (res.status === "ok") {
      state.close();
      setArchivedId(sketchpad.id);
    }
  };
  const reopen = async (reopenId: string) => {
    setArchivedId(null);
    const res = await client.get(reopenId);
    if (res.status !== "ok") {
      setLoadError(res.message);
      return;
    }
    const reopened = res.sketchpad.archived
      ? await change(res.sketchpad, { archived: false })
      : res;
    if (reopened.status === "ok") {
      state.put(reopened.sketchpad);
      state.open(reopenId);
    }
  };

  const archived = archivedId !== null ? snapshot.byId[archivedId] : undefined;

  // Typing that did not get through after its sketchpad was closed, and is
  // not on screen to be offered back: the open one shows its own.
  const elsewhere = Object.entries(snapshot.problems).find(
    ([problemId]) =>
      problemId !== id || snapshot.byId[problemId]?.archived === true,
  );
  const keepMine = async (problemId: string, problem: SaverProblem) => {
    if (problem.kind !== "archived") {
      // Opened, it offers what was typed back itself.
      state.open(problemId);
      return;
    }
    state.setProblem(problemId, null);
    const res = await client.update({
      id: problemId,
      baseVersion: problem.sketchpad.version,
      text: problem.mine,
      archived: false,
    });
    if (res.status === "ok") {
      state.put(res.sketchpad);
      state.open(problemId);
      sketchpads.refresh();
    } else {
      state.setProblem(problemId, {
        kind: "failed",
        mine: problem.mine,
        message: res.message,
        retryable: true,
      });
      setLoadError(res.message);
    }
  };

  return (
    <SketchpadWorkspace
      preview={<PagePreview page={known?.page ?? null} />}
      sketchpads={{
        sketchpads: sketchpads.items,
        currentId: id,
        onOpen: (openId) => state.open(openId),
        onReopen: (reopenId) => void reopen(reopenId),
      }}
      notice={
        elsewhere ? (
          <div
            role="alert"
            className="flex shrink-0 items-center gap-3 rounded-lg bg-bg-warning-secondary px-3 py-1.5 text-xs text-fg-warning-secondary"
          >
            <span>
              Your last edit to “
              {snapshot.byId[elsewhere[0]]?.title ?? "a sketchpad"}” was not
              saved
              {elsewhere[1].kind === "archived"
                ? ": someone archived it meanwhile."
                : "."}
            </span>
            <button
              type="button"
              onClick={() => void keepMine(elsewhere[0], elsewhere[1])}
              className="cursor-pointer font-medium underline"
            >
              {elsewhere[1].kind === "archived"
                ? "Reopen it and keep my edit"
                : "Open it"}
            </button>
          </div>
        ) : archived ? (
          <div
            role="status"
            className="flex shrink-0 items-center gap-3 rounded-lg border border-border-primary bg-bg-primary px-3 py-1.5 text-xs text-fg-secondary"
          >
            <span>
              Archived “{archived.title ?? archived.page ?? "Untitled sketch"}”.
              Reopen it from the list of sketchpads.
            </span>
            <button
              type="button"
              onClick={() => void reopen(archived.id)}
              className="cursor-pointer font-medium text-fg-primary underline"
            >
              Undo
            </button>
          </div>
        ) : loadError ? (
          <div
            role="alert"
            className="flex shrink-0 items-center gap-3 rounded-lg bg-bg-error-secondary px-3 py-1.5 text-xs text-fg-error-secondary"
          >
            <span>The sketchpad could not be opened. {loadError}</span>
            <button
              type="button"
              onClick={() => {
                setLoadError(null);
                state.close();
                if (id !== null) {
                  state.open(id);
                }
              }}
              className="cursor-pointer font-medium underline"
            >
              Try again
            </button>
          </div>
        ) : undefined
      }
      sketchpad={
        known && !known.archived ? (
          <OpenSketchpad
            key={known.id}
            sketchpad={known}
            client={client}
            state={state}
            onSaved={sketchpads.refresh}
            onPageChange={(page) => void change(known, { page })}
            onArchive={() => void archive(known)}
            onSendToAssistant={
              onSendToAssistant && (() => onSendToAssistant(known))
            }
            onOpenAssistant={onOpenAssistant}
            pageOptions={pageOptions}
            currentProfileId={currentProfileId}
            assistantRead={snapshot.assistantRead[known.id]}
            problem={snapshot.problems[known.id]}
            list={{
              sketchpads: sketchpads.items,
              currentId: id,
              onOpen: (openId) => state.open(openId),
              onReopen: (reopenId) => void reopen(reopenId),
            }}
          />
        ) : null
      }
    />
  );
}

function OpenSketchpad({
  sketchpad,
  client,
  state,
  onSaved,
  onPageChange,
  onArchive,
  onSendToAssistant,
  onOpenAssistant,
  pageOptions,
  currentProfileId,
  list,
  assistantRead,
  problem: problemOnOpen,
}: {
  sketchpad: SketchpadT;
  client: SketchpadClient;
  state: SketchpadsState;
  onSaved: () => void;
  onPageChange: (page: string | null) => void;
  onArchive: () => void;
  onSendToAssistant?: () => void;
  onOpenAssistant?: () => void;
  pageOptions: string[];
  currentProfileId: string | null;
  list: Parameters<typeof Sketchpad>[0]["sketchpads"];
  /** The version the assistant last read or wrote, if any. */
  assistantRead: number | undefined;
  /** What did not reach the server when it was last closed. */
  problem: SaverProblem | undefined;
}) {
  // What is on screen: the server's text until someone types here.
  const [text, setText] = useState(sketchpad.text);
  // A phone has no room for the page beside the sketch, so it offers the
  // whole screen to the two of them instead.
  const breakpoint = useShellBreakpoint();
  const [problem, setProblem] = useState<SaverProblem | null>(
    problemOnOpen ?? null,
  );
  const [status, setStatus] = useState<SaverStatus>({
    saving: false,
    unsaved: false,
  });
  const onSavedRef = useRef(onSaved);
  onSavedRef.current = onSaved;

  const [saver] = useState(
    () =>
      new SketchpadSaver(sketchpad, client, {
        onReplace: () => undefined,
        onSaved: () => undefined,
        onProblem: () => undefined,
        onStatus: () => undefined,
      }),
  );

  // While it is on screen the saver's news is shown here; once it is closed
  // a save on the way out may still be answered, and its news is kept for
  // the next time it is opened. See `SketchpadsState.problems`.
  useEffect(() => {
    state.setProblem(sketchpad.id, null);
    saver.setEvents({
      onReplace: (next) => {
        state.put(next);
        setText(next.text);
      },
      onSaved: (saved) => {
        state.put(saved);
        setProblem(null);
        onSavedRef.current();
      },
      onProblem: setProblem,
      onStatus: setStatus,
    });
    return () => {
      saver.setEvents({
        onReplace: (next) => state.put(next),
        onSaved: (saved) => state.put(saved),
        onProblem: (closed) => state.setProblem(sketchpad.id, closed),
        onStatus: () => undefined,
      });
      // Saved on the way out too, so closing it never drops the last edit.
      void saver.flush();
    };
  }, [saver, state, sketchpad.id]);

  // A newer version from elsewhere: the assistant's write, a refetch.
  useEffect(() => {
    saver.remote(sketchpad);
  }, [saver, sketchpad]);

  // Leaving the Studio with typing not saved yet asks first.
  useEffect(() => {
    if (!status.unsaved) {
      return;
    }
    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      void saver.flush();
      event.preventDefault();
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [saver, status.unsaved]);

  const onChange = (next: string) => {
    setText(next);
    saver.edit(next);
  };

  const putBack = (mine: string) => {
    setProblem(null);
    setText(mine);
    saver.retry(mine);
  };

  const changedBySomeoneElse =
    sketchpad.updatedBy !== null && sketchpad.updatedBy !== currentProfileId;
  const assistantStatus: SketchpadAssistantStatus =
    assistantRead === sketchpad.version && !status.unsaved ? "read" : "changed";

  return (
    <div className="flex h-full min-h-0 flex-col gap-2">
      {problem && (
        <div
          role="alert"
          className="flex shrink-0 flex-wrap items-center gap-x-3 gap-y-1 rounded-lg bg-bg-warning-secondary px-3 py-1.5 text-xs text-fg-warning-secondary"
        >
          {problem.kind === "conflict" ? (
            <>
              <span>
                It was changed elsewhere while you were typing (version{" "}
                {problem.sketchpad.version}). This is the newest; your last edit
                is kept.
              </span>
              <button
                type="button"
                onClick={() => putBack(problem.mine)}
                className="cursor-pointer font-medium underline"
              >
                Put mine back
              </button>
            </>
          ) : problem.kind === "archived" ? (
            <>
              <span>
                Someone archived this sketchpad while you were typing, so your
                last edit was not saved.
              </span>
              <button
                type="button"
                onClick={() => {
                  setProblem(null);
                  setText(problem.mine);
                  void saver.reopenWith(problem.mine);
                }}
                className="cursor-pointer font-medium underline"
              >
                Reopen it and keep my edit
              </button>
            </>
          ) : (
            <>
              <span>Not saved: {problem.message}</span>
              {problem.retryable && (
                <button
                  type="button"
                  onClick={() => putBack(problem.mine)}
                  className="cursor-pointer font-medium underline"
                >
                  Try again
                </button>
              )}
            </>
          )}
        </div>
      )}
      <Sketchpad
        value={text}
        onChange={onChange}
        title={sketchpad.title ?? undefined}
        page={sketchpad.page}
        onPageChange={onPageChange}
        pageOptions={pageOptions}
        status={
          status.saving
            ? "Saving…"
            : status.unsaved
              ? "Not saved yet"
              : changedBySomeoneElse
                ? `Changed ${relative(sketchpad.updatedAt)}`
                : `Saved ${relative(sketchpad.updatedAt)}`
        }
        onAskAssistant={onSendToAssistant}
        onOpenChat={onOpenAssistant}
        assistantStatus={assistantStatus}
        onArchive={onArchive}
        sketchpads={list}
        fullscreenPreview={
          breakpoint === "mobile" ? (
            <PagePreview page={sketchpad.page} />
          ) : undefined
        }
      />
    </div>
  );
}

/** The page the sketch is about, as the site serves it now. */
function PagePreview({ page }: { page: string | null }) {
  if (page === null) {
    return (
      <div className="flex h-full items-center justify-center p-6 text-center text-sm text-fg-secondary">
        This sketch is not about a page yet. Pick one under its title to see the
        page beside it.
      </div>
    );
  }
  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-2 border-b border-border-primary px-3 py-2">
        <span className="text-xs font-medium text-fg-secondary">Preview</span>
        <span className="min-w-0 flex-1 truncate rounded-md bg-bg-secondary px-2 py-1 text-xs text-fg-secondary">
          {page}
        </span>
      </div>
      <iframe
        key={page}
        title={`The page ${page}`}
        src={page}
        className="min-h-0 w-full flex-1 bg-white"
      />
    </div>
  );
}

export function relative(iso: string, now: Date = new Date()): string {
  const seconds = Math.round((now.getTime() - new Date(iso).getTime()) / 1000);
  if (Number.isNaN(seconds) || seconds < 45) {
    return "just now";
  }
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) {
    return `${minutes} min ago`;
  }
  const hours = Math.round(minutes / 60);
  if (hours < 24) {
    return `${hours} h ago`;
  }
  return new Date(iso).toLocaleDateString();
}

const SEEN_KEY = "val:sketchpads-seen";

/** The version of each sketchpad this browser last had on screen. */
export function readSeen(): Record<string, number> {
  try {
    const raw = window.localStorage.getItem(SEEN_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : {};
    if (typeof parsed !== "object" || parsed === null) {
      return {};
    }
    return Object.fromEntries(
      Object.entries(parsed).filter(
        (entry): entry is [string, number] => typeof entry[1] === "number",
      ),
    );
  } catch {
    return {};
  }
}

function markSeen(sketchpad: SketchpadT) {
  try {
    const seen = readSeen();
    if ((seen[sketchpad.id] ?? 0) < sketchpad.version) {
      seen[sketchpad.id] = sketchpad.version;
      window.localStorage.setItem(SEEN_KEY, JSON.stringify(seen));
    }
  } catch {
    // A convenience: without it the top bar's dot is merely more eager.
  }
}
