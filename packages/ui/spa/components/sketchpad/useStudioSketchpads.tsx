import type { SketchpadSummaryT, SketchpadT } from "@valbuild/shared/internal";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { useClient } from "../ValProvider";
import type { TopBarSketchpad } from "../shell/TopBar";
import type { ShellPage } from "../shell/types";
import { createSketchpadClient } from "./sketchpadClient";
import type { SketchpadListItem } from "./SketchpadList";
import {
  SketchpadsProvider,
  SketchpadsState,
  useSketchpadsSnapshot,
} from "./SketchpadsState";
import { readSeen, relative, ValSketchpad } from "./ValSketchpad";

/**
 * Everything the Studio's shell does with sketchpads, for `ValShell` to pass
 * on: the state its parts share (the assistant's tools included, through the
 * provider), the top bar's button, "Sketch changes" on a page, and the
 * workspace while one is open.
 *
 * Nothing is offered by a site whose Val server predates sketchpads: the
 * first list tells, and until it answers there is nothing to show anyway.
 */
export function useStudioSketchpads(options: {
  /** Opens the assistant, docked beside the Sketchpad; null without one. */
  openAssistant: (() => void) | null;
  pages: ShellPage[];
  currentProfileId: string | null;
}): {
  wrap: (children: ReactNode) => ReactNode;
  sketchpad: TopBarSketchpad | undefined;
  onSketchPage: ((page: ShellPage) => void) | undefined;
  workspaceOverride: ReactNode | undefined;
} {
  const { openAssistant, pages, currentProfileId } = options;
  const valClient = useClient();
  const client = useMemo(() => createSketchpadClient(valClient), [valClient]);
  const [state] = useState(() => new SketchpadsState());
  const snapshot = useSketchpadsSnapshot(state);
  const [summaries, setSummaries] = useState<SketchpadSummaryT[] | null>(null);
  const [available, setAvailable] = useState(false);
  const lastOpened = useRef<string | null>(null);

  const refresh = useCallback(async () => {
    const res = await client.list({ archived: "include" });
    if (res.status === "ok") {
      setSummaries(res.sketchpads);
      setAvailable(true);
    }
  }, [client]);

  // On load, when this tab learns of a sketchpad the list lacks (the
  // assistant made one), and on coming back to the tab -- someone else may
  // have changed one meanwhile. Not on every new version: the rows take
  // those from the state, and a save is a version.
  const knownIds = Object.keys(snapshot.byId).sort().join(",");
  useEffect(() => {
    void refresh();
  }, [refresh, knownIds]);
  useEffect(() => {
    const onFocus = () => void refresh();
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, [refresh]);

  useEffect(() => {
    if (snapshot.openId !== null) {
      lastOpened.current = snapshot.openId;
    }
  }, [snapshot.openId]);

  // The list's rows, with anything this tab knows newer than the list.
  const items: SketchpadListItem[] = useMemo(
    () =>
      (summaries ?? []).map((summary) => {
        const newer = snapshot.byId[summary.id];
        const sketchpad =
          newer && newer.version > summary.version ? newer : summary;
        return {
          id: sketchpad.id,
          title: sketchpad.title,
          page: sketchpad.page,
          archived: sketchpad.archived,
          detail: `${sketchpad.archived ? "Archived" : "Changed"} ${relative(sketchpad.updatedAt)}`,
        };
      }),
    [summaries, snapshot.byId],
  );

  const open = (id: string) => {
    state.open(id);
    openAssistant?.();
  };

  const onSketchPage = async (page: ShellPage) => {
    const existing = (summaries ?? []).find(
      (sketchpad) => !sketchpad.archived && sketchpad.page === page.urlPath,
    );
    if (existing) {
      open(existing.id);
      return;
    }
    const res = await client.create({ text: "", page: page.urlPath });
    if (res.status === "ok") {
      state.put(res.sketchpad);
      open(res.sketchpad.id);
      void refresh();
    }
  };

  const sendToAssistant = (sketchpad: SketchpadT) => {
    openAssistant?.();
    state.sendToAssistant(
      `Read the sketchpad “${sketchpad.title ?? sketchpad.page ?? "Untitled sketch"}” (id ${sketchpad.id}) and tell me what you think.`,
    );
  };

  const unarchived = (summaries ?? []).filter((s) => !s.archived);
  const seen = readSeen();
  const changed = unarchived.some(
    (sketchpad) =>
      sketchpad.version > (seen[sketchpad.id] ?? 0) &&
      sketchpad.updatedBy !== currentProfileId,
  );

  // Once each: a route pattern is in the tree once per page under it.
  const pageOptions = useMemo(
    () => Array.from(new Set(routesOf(pages))),
    [pages],
  );

  return {
    wrap: (children) => (
      <SketchpadsProvider state={state}>{children}</SketchpadsProvider>
    ),
    sketchpad:
      available && (unarchived.length > 0 || snapshot.openId !== null)
        ? {
            open: snapshot.openId !== null,
            changed,
            onToggle: () => {
              if (snapshot.openId !== null) {
                state.close();
                return;
              }
              const target =
                unarchived.find((s) => s.id === lastOpened.current) ??
                unarchived[0];
              if (target) {
                open(target.id);
              }
            },
          }
        : undefined,
    onSketchPage: available ? (page) => void onSketchPage(page) : undefined,
    workspaceOverride:
      snapshot.openId !== null ? (
        <ValSketchpad
          state={state}
          client={client}
          sketchpads={{ items, refresh: () => void refresh() }}
          onSendToAssistant={openAssistant ? sendToAssistant : undefined}
          pageOptions={pageOptions}
          currentProfileId={currentProfileId}
        />
      ) : undefined,
  };
}

function routesOf(pages: ShellPage[]): string[] {
  return pages.flatMap((page) => [
    page.urlPath,
    ...routesOf(page.children ?? []),
  ]);
}
