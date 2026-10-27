import { useCallback, useEffect, useRef } from "react";
import { isTextEntryFocused } from "../utils/deepActiveElement";

export type ComposerFocusRestore = {
  /**
   * Call when a message has actually gone out. Only then: the restore fires on
   * the composer becoming usable again, and a send that never happened never
   * makes it unusable - so an arm without a send survives until the next thing
   * that does re-enable the composer (a reconnect, say) and steals the caret
   * from wherever the user had gone in the meantime.
   */
  armForSend: () => void;
};

/**
 * Put the caret back in the composer when the assistant is done answering.
 *
 * The composer is made non-editable while the answer streams, and ProseMirror
 * drops the DOM selection when it does. Nothing put it back, so the caret was
 * gone every time a message completed and the next question had to start with a
 * click.
 *
 * Armed at send time rather than measured here: by the time this effect runs the
 * editor's own effect has already made the view non-editable and taken the focus
 * with it, so there is nothing left to observe.
 */
export function useComposerFocusRestore(
  composerDisabled: boolean,
  focusComposer: () => void,
): ComposerFocusRestore {
  const armed = useRef(false);
  const armForSend = useCallback(() => {
    armed.current = true;
  }, []);
  useEffect(() => {
    if (composerDisabled || !armed.current) {
      return;
    }
    armed.current = false;
    // Don't steal the caret from a field the user moved to while waiting for
    // the answer.
    if (isTextEntryFocused()) {
      return;
    }
    // After paint: `editable` is re-applied in an effect of the editor's own,
    // and focusing a still-non-editable view does nothing.
    const raf = requestAnimationFrame(focusComposer);
    return () => cancelAnimationFrame(raf);
  }, [composerDisabled, focusComposer]);
  return { armForSend };
}
