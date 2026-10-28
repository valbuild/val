import type { SketchpadT } from "@valbuild/shared/internal";
import { useCallback, useEffect, useRef, useState } from "react";
import { Sketchpad, type SketchpadAssistantStatus } from "./Sketchpad";
import type { SketchpadClient } from "./sketchpadClient";
import type { SketchpadListItem } from "./SketchpadList";
import { useSketchpadsSnapshot, type SketchpadsState } from "./SketchpadsState";
import { SketchpadWorkspace } from "./SketchpadWorkspace";
import { useShellBreakpoint } from "../shell/useShellBreakpoint";

/** How long typing pauses before it is saved. */
const SAVE_AFTER_MS = 700;

type SaveNotice =
  | { kind: "failed"; message: string }
  /** Somebody else's change won; `mine` is what this tab had. */
  | { kind: "conflict"; mine: string };

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

  // Fetched when it is opened, unless this tab already has it.
  useEffect(() => {
    if (id === null || known) {
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
      } else {
        setLoadError(res.message);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [id, known, client, state]);

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
        archived ? (
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
}) {
  // What is on screen: the server's text until someone types here.
  const [text, setText] = useState(sketchpad.text);
  // A phone has no room for the page beside the sketch, so it offers the
  // whole screen to the two of them instead.
  const breakpoint = useShellBreakpoint();
  const [notice, setNotice] = useState<SaveNotice | null>(null);
  const [saving, setSaving] = useState(false);
  // The version the text on screen was typed on, and whether it has been
  // typed in since.
  const base = useRef(sketchpad);
  const dirty = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // For the save on the way out, which runs after the last render.
  const textRef = useRef(text);
  textRef.current = text;

  // A newer version from elsewhere (the assistant's write, a refetch) is
  // taken as it is, unless something typed here is waiting to be saved.
  useEffect(() => {
    if (sketchpad.version > base.current.version && !dirty.current) {
      base.current = sketchpad;
      setText(sketchpad.text);
    }
  }, [sketchpad]);

  const save = useCallback(
    async (next: string) => {
      setSaving(true);
      const res = await client.update({
        id: base.current.id,
        baseVersion: base.current.version,
        text: next,
      });
      setSaving(false);
      if (res.status === "ok") {
        base.current = res.sketchpad;
        dirty.current = false;
        setNotice(null);
        state.put(res.sketchpad);
        onSaved();
      } else if (res.status === "conflict") {
        base.current = res.sketchpad;
        dirty.current = false;
        state.put(res.sketchpad);
        setText(res.sketchpad.text);
        setNotice({ kind: "conflict", mine: next });
      } else {
        setNotice({ kind: "failed", message: res.message });
      }
    },
    [client, state, onSaved],
  );

  const onChange = (next: string) => {
    setText(next);
    dirty.current = true;
    if (timer.current) {
      clearTimeout(timer.current);
    }
    timer.current = setTimeout(() => void save(next), SAVE_AFTER_MS);
  };

  // Saved on the way out too, so closing it never drops the last edit.
  const saveRef = useRef(save);
  saveRef.current = save;
  useEffect(
    () => () => {
      if (timer.current && dirty.current) {
        clearTimeout(timer.current);
        void saveRef.current(textRef.current);
      }
    },
    [],
  );

  const changedBySomeoneElse =
    sketchpad.updatedBy !== null && sketchpad.updatedBy !== currentProfileId;
  const status: SketchpadAssistantStatus =
    assistantRead === sketchpad.version && !dirty.current ? "read" : "changed";

  return (
    <div className="flex h-full min-h-0 flex-col gap-2">
      {notice && (
        <div
          role="alert"
          className="flex shrink-0 flex-wrap items-center gap-x-3 gap-y-1 rounded-lg bg-bg-warning-secondary px-3 py-1.5 text-xs text-fg-warning-secondary"
        >
          {notice.kind === "conflict" ? (
            <>
              <span>
                It changed while you were typing (version {sketchpad.version}).
                This is the newest; your last edit is kept.
              </span>
              <button
                type="button"
                onClick={() => {
                  setNotice(null);
                  setText(notice.mine);
                  dirty.current = true;
                  void save(notice.mine);
                }}
                className="cursor-pointer font-medium underline"
              >
                Put mine back
              </button>
            </>
          ) : (
            <>
              <span>Not saved: {notice.message}</span>
              <button
                type="button"
                onClick={() => void save(text)}
                className="cursor-pointer font-medium underline"
              >
                Try again
              </button>
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
          saving
            ? "Saving…"
            : changedBySomeoneElse
              ? `Changed ${relative(sketchpad.updatedAt)}`
              : `Saved ${relative(sketchpad.updatedAt)}`
        }
        onAskAssistant={onSendToAssistant}
        onOpenChat={onOpenAssistant}
        assistantStatus={status}
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
