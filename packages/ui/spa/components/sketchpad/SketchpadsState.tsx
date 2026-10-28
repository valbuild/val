import type { SketchpadT } from "@valbuild/shared/internal";
import type { SaverProblem } from "./sketchpadSaver";
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
    available: false,
  };
  private readonly listeners = new Set<() => void>();
  private assistant: ((message: string) => boolean) | null = null;

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
