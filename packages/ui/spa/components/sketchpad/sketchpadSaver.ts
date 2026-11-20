import type { SketchpadT } from "@valbuild/shared/internal";
import type { SketchpadClient } from "./sketchpadClient";

/** How long typing pauses before it is saved. */
export const SAVE_AFTER_MS = 700;

export type SaverStatus = {
  /** A save is on its way to the server. */
  saving: boolean;
  /** Something typed here is not on the server yet. */
  unsaved: boolean;
};

/** Why typing did not reach the server, and what was typed. */
export type SaverProblem =
  /** Somebody else's change won. `sketchpad` is theirs, now on screen. */
  | { kind: "conflict"; mine: string; sketchpad: SketchpadT }
  /** Archived elsewhere while typing here. */
  | { kind: "archived"; mine: string; sketchpad: SketchpadT }
  /** The save did not get through. `retry` sends it again. */
  | { kind: "failed"; mine: string; message: string; retryable: boolean };

export type SaverEvents = {
  /** A newer version from elsewhere is what should be on screen now. */
  onReplace: (sketchpad: SketchpadT) => void;
  onSaved: (sketchpad: SketchpadT) => void;
  onProblem: (problem: SaverProblem) => void;
  onStatus: (status: SaverStatus) => void;
};

/**
 * Saves what is typed in one sketchpad: after a pause, one save at a time,
 * each made on the version the one before it came back with.
 *
 * One at a time because a save names the version it was typed on. Two in
 * flight name the same one, the second is refused as a conflict with the
 * first -- this tab's own save -- and what was typed after it is in neither.
 *
 * A text that is what the server already has is not sent: an edit that
 * changes nothing on the page is no new version.
 *
 * A newer version from elsewhere (the assistant wrote) replaces the screen
 * only when nothing typed here is waiting. When something is, the save it
 * makes is refused as a conflict, and the person is offered theirs back --
 * neither is dropped in silence.
 */
export class SketchpadSaver {
  private base: SketchpadT;
  /** Typed, not yet sent. */
  private pending: string | null = null;
  /** Sent, not yet answered. */
  private sending: string | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private status: SaverStatus = { saving: false, unsaved: false };

  constructor(
    sketchpad: SketchpadT,
    private readonly client: SketchpadClient,
    private events: SaverEvents,
  ) {
    this.base = sketchpad;
  }

  /** The events go to whoever shows the sketchpad now: after it closes, elsewhere. */
  setEvents(events: SaverEvents) {
    this.events = events;
  }

  get version(): number {
    return this.base.version;
  }

  /** Whatever was typed here last, sent or not. */
  private latest(): string {
    return this.pending ?? this.sending ?? this.base.text;
  }

  edit(text: string) {
    if (text === this.latest()) {
      return;
    }
    this.pending =
      text === this.base.text && this.sending === null ? null : text;
    this.clearTimer();
    if (this.pending !== null) {
      this.timer = setTimeout(() => void this.flush(), SAVE_AFTER_MS);
    }
    this.report();
  }

  /** Sends what is waiting now, rather than after the pause. */
  async flush(): Promise<void> {
    this.clearTimer();
    if (this.sending !== null || this.pending === null) {
      return;
    }
    const text = this.pending;
    this.pending = null;
    this.sending = text;
    this.report();
    const res = await this.client.update({
      id: this.base.id,
      baseVersion: this.base.version,
      text,
    });
    this.sending = null;
    if (res.status === "ok") {
      this.base = res.sketchpad;
      if (this.pending === this.base.text) {
        this.pending = null;
      }
      this.events.onSaved(res.sketchpad);
      this.report();
      // Typed while that was on its way: on the version it came back with.
      if (this.pending !== null) {
        void this.flush();
      }
      return;
    }
    const mine = this.pending ?? text;
    this.pending = null;
    if (res.status === "conflict") {
      this.base = res.sketchpad;
      this.events.onReplace(res.sketchpad);
      this.events.onProblem({
        kind: "conflict",
        mine,
        sketchpad: res.sketchpad,
      });
    } else if (res.status === "refused") {
      // An archive from elsewhere is refused, not a conflict: say which.
      const now = await this.client.get(this.base.id);
      if (now.status === "ok" && now.sketchpad.archived) {
        this.base = now.sketchpad;
        this.events.onProblem({
          kind: "archived",
          mine,
          sketchpad: now.sketchpad,
        });
      } else {
        this.events.onProblem({
          kind: "failed",
          mine,
          message: res.message,
          retryable: false,
        });
      }
    } else {
      this.events.onProblem({
        kind: "failed",
        mine,
        message: res.message,
        retryable: res.status === "failed",
      });
    }
    this.report();
  }

  /** `text` again, on the version on screen now: "Put mine back", "Try again". */
  retry(text: string) {
    this.pending = text === this.base.text ? null : text;
    this.report();
    void this.flush();
  }

  /** Reopens an archived sketchpad with `text` in it, in one change. */
  async reopenWith(text: string): Promise<void> {
    this.sending = text;
    this.report();
    const res = await this.client.update({
      id: this.base.id,
      baseVersion: this.base.version,
      text,
      archived: false,
    });
    this.sending = null;
    if (res.status === "ok") {
      this.base = res.sketchpad;
      this.events.onSaved(res.sketchpad);
    } else {
      this.events.onProblem({
        kind: "failed",
        mine: text,
        message: res.message,
        retryable: res.status === "failed" || res.status === "conflict",
      });
    }
    this.report();
  }

  /** A version this tab learned of another way: the assistant's, a refetch. */
  remote(sketchpad: SketchpadT) {
    if (sketchpad.version <= this.base.version) {
      return;
    }
    if (this.pending === null && this.sending === null) {
      this.base = sketchpad;
      this.events.onReplace(sketchpad);
    }
  }

  private clearTimer() {
    if (this.timer !== null) {
      clearTimeout(this.timer);
      this.timer = null;
    }
  }

  private report() {
    const next: SaverStatus = {
      saving: this.sending !== null,
      unsaved: this.pending !== null || this.sending !== null,
    };
    if (
      next.saving !== this.status.saving ||
      next.unsaved !== this.status.unsaved
    ) {
      this.status = next;
      this.events.onStatus(next);
    }
  }
}
