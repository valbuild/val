import type { SketchpadT } from "@valbuild/shared/internal";
import type { SaverProblem } from "./sketchpadSaver";
import type { SketchHighlight } from "./highlights";
import {
  createContext,
  useContext,
  useSyncExternalStore,
  type ReactNode,
} from "react";

export type SketchpadsSnapshot = {
  /** The sketchpad on screen, if any. */
  openId: string | null;
  /** The newest version this tab has seen of each sketchpad it has read. */
  byId: Readonly<Record<string, SketchpadT>>;
  /**
   * The version of each sketchpad the assistant last read or wrote in this
   * tab -- what "Send to AI" compares with to say there is news for it.
   */
  assistantRead: Readonly<Record<string, number>>;
  /**
   * Typing that did not reach the server after its sketchpad was closed: the
   * save on the way out was refused, or failed. Shown when it is opened
   * again, with what was typed one press away.
   */
  problems: Readonly<Record<string, SaverProblem>>;
  /**
   * Blocks the assistant points at in each sketchpad
   * (`highlight_sketchpad_blocks`), until it, or the person, clears them.
   * Kept in the tab, not on the server: they are part of the conversation,
   * not of the sketch.
   */
  highlights: Readonly<Record<string, SketchHighlight[]>>;
  /**
   * Images put in the assistant's session from this tab -- in a box, or
   * attached in the chat -- newest first. A box names one as
   * `session:<key>`; only the tab that uploaded it can show it, from the
   * file it still has.
   */
  sessionImages: readonly SessionImage[];
  /**
   * Whether this Studio's server has sketchpads: a list came back. Until it
   * does, nothing offers them, the assistant included.
   */
  available: boolean;
};

/**
 * What the Studio's parts share about sketchpads in one tab: which one is
 * open, the newest version of each it knows, and how to hand one to the
 * assistant.
 *
 * Shared because the parts that change sketchpads do not know of each other.
 * The assistant's tools make and write them (and open one, so the person
 * sees what was made); the Sketchpad view edits the open one; the top bar
 * shows that there is one. The server is still where they live -- this is
 * what has been read from it, so a write by one part is seen by the others
 * without a second request.
 */
export class SketchpadsState {
  private snapshot: SketchpadsSnapshot = {
    openId: null,
    byId: {},
    assistantRead: {},
    problems: {},
    highlights: {},
    sessionImages: [],
    available: false,
  };
  private readonly listeners = new Set<() => void>();
  private assistant: ((message: string) => boolean) | null = null;
  private uploader: SessionUploader | null = null;

  readonly subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  readonly getSnapshot = () => this.snapshot;

  private set(next: SketchpadsSnapshot) {
    this.snapshot = next;
    this.listeners.forEach((listener) => listener());
  }

  setAvailable(available: boolean) {
    if (this.snapshot.available !== available) {
      this.set({ ...this.snapshot, available });
    }
  }

  open(id: string) {
    if (this.snapshot.openId !== id) {
      this.set({ ...this.snapshot, openId: id });
    }
  }

  close() {
    if (this.snapshot.openId !== null) {
      this.set({ ...this.snapshot, openId: null });
    }
  }

  /** Keeps `sketchpad` unless a newer version of it is already known. */
  put(sketchpad: SketchpadT) {
    const known = this.snapshot.byId[sketchpad.id];
    if (known && known.version >= sketchpad.version) {
      return;
    }
    this.set({
      ...this.snapshot,
      byId: { ...this.snapshot.byId, [sketchpad.id]: sketchpad },
    });
  }

  setProblem(id: string, problem: SaverProblem | null) {
    const { [id]: current, ...rest } = this.snapshot.problems;
    if (problem === null && current === undefined) {
      return;
    }
    this.set({
      ...this.snapshot,
      problems: problem === null ? rest : { ...rest, [id]: problem },
    });
  }

  /** The assistant has seen `sketchpad` as it is: it read or wrote it. */
  markAssistantRead(sketchpad: SketchpadT) {
    this.put(sketchpad);
    if (this.snapshot.assistantRead[sketchpad.id] === sketchpad.version) {
      return;
    }
    this.set({
      ...this.snapshot,
      assistantRead: {
        ...this.snapshot.assistantRead,
        [sketchpad.id]: sketchpad.version,
      },
    });
  }

  /** Adds highlights to a sketchpad, replacing any with the same id. */
  addHighlights(id: string, added: SketchHighlight[]) {
    const ids = new Set(added.map((highlight) => highlight.id));
    const kept = (this.snapshot.highlights[id] ?? []).filter(
      (highlight) => !ids.has(highlight.id),
    );
    this.set({
      ...this.snapshot,
      highlights: { ...this.snapshot.highlights, [id]: [...kept, ...added] },
    });
  }

  /** Clears one highlight of a sketchpad, or all of them with null. */
  clearHighlight(id: string, highlightId: string | null) {
    const current = this.snapshot.highlights[id];
    if (!current) {
      return;
    }
    const { [id]: _cleared, ...rest } = this.snapshot.highlights;
    const kept =
      highlightId === null
        ? []
        : current.filter((highlight) => highlight.id !== highlightId);
    this.set({
      ...this.snapshot,
      highlights: kept.length > 0 ? { ...rest, [id]: kept } : rest,
    });
  }

  /** An image went into the assistant's session from this tab. */
  addSessionImage(image: SessionImage) {
    this.set({
      ...this.snapshot,
      sessionImages: [
        image,
        ...this.snapshot.sessionImages.filter((i) => i.key !== image.key),
      ],
    });
  }

  /**
   * The chat registers how a file goes into its session, while it is
   * mounted: a file put in a box goes there first, so the assistant can see
   * it and put it in the site when it builds.
   */
  registerUploader(upload: SessionUploader): () => void {
    this.uploader = upload;
    this.set({ ...this.snapshot });
    return () => {
      if (this.uploader === upload) {
        this.uploader = null;
        this.set({ ...this.snapshot });
      }
    };
  }

  /** Null when there is no chat to upload to. */
  getUploader(): SessionUploader | null {
    return this.uploader;
  }

  /**
   * The chat registers how to send it a message, while it is mounted. The
   * Sketchpad's "Send to AI" is that, with the sketchpad's id in it.
   */
  registerAssistant(send: (message: string) => boolean): () => void {
    this.assistant = send;
    return () => {
      if (this.assistant === send) {
        this.assistant = null;
      }
    };
  }

  /** False when there is no chat to send to, or it would not take one now. */
  sendToAssistant(message: string): boolean {
    return this.assistant?.(message) ?? false;
  }
}

export type SessionImage = {
  key: string;
  /** Where this tab shows it from: an object URL of the file it uploaded. */
  url: string;
  name: string;
};

/**
 * Puts a file in the assistant's session, resolving to its key: a box names
 * it as `session:<key>`.
 */
export type SessionUploader = (file: File) => Promise<{ key: string }>;

const SketchpadsContext = createContext<SketchpadsState | null>(null);

export function SketchpadsProvider({
  state,
  children,
}: {
  state: SketchpadsState;
  children: ReactNode;
}) {
  return (
    <SketchpadsContext.Provider value={state}>
      {children}
    </SketchpadsContext.Provider>
  );
}

/**
 * Null outside the Studio's shell -- the overlay, the design tab -- where the
 * assistant's sketchpad tools still work, with nothing on screen to open.
 */
export function useSketchpadsState(): SketchpadsState | null {
  return useContext(SketchpadsContext);
}

const EMPTY: SketchpadsSnapshot = {
  openId: null,
  byId: {},
  assistantRead: {},
  problems: {},
  highlights: {},
  sessionImages: [],
  available: false,
};
const noSubscription = () => () => undefined;

export function useSketchpadsSnapshot(
  state: SketchpadsState | null,
): SketchpadsSnapshot {
  return useSyncExternalStore(
    state?.subscribe ?? noSubscription,
    state?.getSnapshot ?? (() => EMPTY),
  );
}
