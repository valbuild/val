import { useCallback, useEffect, useRef, useState } from "react";
import { Internal, type SourcePath } from "@valbuild/core";
import type { Patch } from "@valbuild/core/patch";
import type { InlineEditValue } from "@valbuild/shared/internal";
import { useValSystem } from "../../../stores/react/SystemContext";
import { writePatch } from "../../../stores/react/writePatch";
import { stringFieldPatch } from "../../fields/stringFieldPatch";
import { richTextFieldPatch } from "../../fields/richTextFieldPatch";
import { useDebouncedFieldWrite } from "../../fields/useDebouncedFieldWrite";
import {
  type CanvasInlineEditCandidate,
  inlineEditCandidates,
} from "./inlineEditCandidates";

/** What `CanvasFrame` asks the page: see its `inlineEdit` prop. */
export type CanvasInlineEditRequest = {
  requestId: string;
  candidates: CanvasInlineEditCandidate[];
};

/**
 * Editing on the page, from the Studio's side (the beta; the page's side is
 * `inlineEditing.ts` in `@valbuild/shared`).
 *
 * A pick on the page is {@link CanvasInlineEdit.offer}ed here first. When
 * one of the picked element's fields is a string or a richtext, the page is
 * asked to put the caret in it (`request`, which `CanvasFrame` sends). The
 * page either does -- and what is typed comes back through `onEdit` and is
 * written as the field in the column writes it -- or says it cannot, and the
 * caller opens the field in the column as a pick always has.
 *
 * So turning the beta on never takes a way of editing away: whatever cannot
 * be typed on the page is one round trip from being opened where it always
 * was.
 */
export type CanvasInlineEdit = {
  /**
   * A pick on the page. True when the page was asked to edit one of the
   * paths in place; false when none of them can be and the caller should
   * do what a pick does.
   */
  offer: (paths: SourcePath[]) => boolean;
  /** For `CanvasFrame`'s `inlineEdit`. */
  request: CanvasInlineEditRequest | null;
  /**
   * The field the caret is in, on the page, or `null`. The page outlines it
   * itself, so the outline of whatever the column has open is taken down
   * for as long: two outlines say two things are selected.
   */
  editingPath: SourcePath | null;
  onStarted: (requestId: string, path: SourcePath) => void;
  onEdit: (path: SourcePath, value: InlineEditValue) => void;
  onEnded: (path: SourcePath) => void;
  /**
   * The page cannot edit what was offered. Returns the paths that were
   * picked, for the caller to open the usual way -- or `null` when the
   * answer is to a request that has been replaced since.
   */
  onUnavailable: (requestId: string) => SourcePath[] | null;
};

type Pending = {
  request: CanvasInlineEditRequest;
  /** Everything on the picked element: what a pick opens otherwise. */
  paths: SourcePath[];
};

/**
 * The patch an edit on the page writes: the field's own, by its kind
 * (`stringFieldPatch`, `richTextFieldPatch`), or `null` when the value is
 * not what a field of that kind holds.
 *
 * Its own function so a test writes what the Studio writes.
 */
export function inlineEditPatch(
  candidate: Pick<CanvasInlineEditCandidate, "path" | "kind">,
  value: InlineEditValue,
): Patch | null {
  const [, modulePath] = Internal.splitModuleFilePathAndModulePath(
    candidate.path,
  );
  const patchPath = Internal.createPatchPath(modulePath);
  if (typeof value === "string") {
    return candidate.kind === "string"
      ? stringFieldPatch(patchPath, value)
      : null;
  }
  return candidate.kind === "richtext"
    ? richTextFieldPatch(patchPath, value)
    : null;
}

export function useCanvasInlineEdit({
  enabled,
}: {
  /**
   * The beta is on, and fields may be written: not while the first load's
   * patches are still coming in (`PendingChangesGate`), when the column's
   * fields are read-only and a caret on the page would be a way around
   * that. Off, every pick is refused and nothing is asked.
   */
  enabled: boolean;
}): CanvasInlineEdit {
  const val = useValSystem();
  /*
   * What was asked, as state for `CanvasFrame` to send and as a ref for the
   * answers: the page answers faster than a render, and an answer read from
   * the render before it was asked would be an answer to nothing.
   */
  const [request, setRequest] = useState<CanvasInlineEditRequest | null>(null);
  const pending = useRef<Pending | null>(null);
  /** The field the caret is in, from the page's `started` to its `ended`. */
  const active = useRef<CanvasInlineEditCandidate | null>(null);
  const [editingPath, setEditingPath] = useState<SourcePath | null>(null);
  const requestCount = useRef(0);

  /*
   * One patch per pause in typing, never one per keystroke, capped so that
   * fluent typing still writes -- the field's own rule and the field's own
   * hook for it. What is still waiting when the Studio goes away is written
   * by the hook's unmount.
   */
  const system = val?.system ?? null;
  const write = useDebouncedFieldWrite<{
    candidate: CanvasInlineEditCandidate;
    value: InlineEditValue;
  }>(({ candidate, value }) => {
    const patch = inlineEditPatch(candidate, value);
    if (system === null || patch === null) return;
    const [moduleFilePath] = Internal.splitModuleFilePathAndModulePath(
      candidate.path,
    );
    void writePatch(system, moduleFilePath, patch).then((res) => {
      if (res.status === "error") {
        Internal.log.error("could not write patch", res.message);
      }
    });
  });

  const withdraw = useCallback(() => {
    pending.current = null;
    setRequest(null);
  }, []);

  // Turned off mid-edit: nothing is asked any more, and `CanvasFrame` tells
  // the page to stop when the request goes.
  useEffect(() => {
    if (!enabled) withdraw();
  }, [enabled, withdraw]);

  const offer = useCallback(
    (paths: SourcePath[]): boolean => {
      if (!enabled || system === null) return false;
      const candidates = inlineEditCandidates(
        paths,
        system.sourceStore.allSources(),
        system.schemaStore.all(),
      );
      if (candidates.length === 0) return false;
      requestCount.current += 1;
      const next: CanvasInlineEditRequest = {
        requestId: `inline-${requestCount.current}`,
        candidates,
      };
      pending.current = { request: next, paths };
      setRequest(next);
      return true;
    },
    [enabled, system],
  );

  const onStarted = useCallback((requestId: string, path: SourcePath) => {
    const asked = pending.current;
    if (asked === null || asked.request.requestId !== requestId) return;
    active.current =
      asked.request.candidates.find((candidate) => candidate.path === path) ??
      null;
    setEditingPath(active.current?.path ?? null);
  }, []);

  const onEdit = useCallback(
    (path: SourcePath, value: InlineEditValue) => {
      const candidate = active.current;
      if (candidate === null || candidate.path !== path) return;
      write.push({ candidate, value });
    },
    [write],
  );

  const onEnded = useCallback(
    (path: SourcePath) => {
      const candidate = active.current;
      if (candidate === null || candidate.path !== path) return;
      active.current = null;
      setEditingPath(null);
      // Written now rather than on the pause: the page is waiting to show
      // its own element again, and shows the old words until this lands.
      write.flush();
      // Unless another field has been asked for since.
      if (
        pending.current?.request.candidates.some((asked) => asked.path === path)
      ) {
        withdraw();
      }
    },
    [write, withdraw],
  );

  const onUnavailable = useCallback(
    (requestId: string): SourcePath[] | null => {
      const asked = pending.current;
      if (asked === null || asked.request.requestId !== requestId) return null;
      withdraw();
      return asked.paths;
    },
    [withdraw],
  );

  return {
    offer,
    request,
    editingPath,
    onStarted,
    onEdit,
    onEnded,
    onUnavailable,
  };
}
