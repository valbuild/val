import { useEffect, useMemo, useRef, useState } from "react";
import { usePatchSets, usePublishSummary } from "./ValProvider";
import { useValSystem } from "../stores/react/SystemContext";
import { PublishSummaryView } from "./PublishSummaryView";
import {
  buildDefaultCommitMessage,
  shouldAutoApplyAiSummary,
} from "./publish/defaultCommitSummary";
import { renderChangeDescription } from "./publish/changeDescription";
import { collectFieldChanges } from "./publish/collectFieldChanges";
import { useCommitSummary } from "../hooks/useCommitSummary";
import { useAvailableAIModel } from "./ValProvider";
import { useSessionParam } from "./ValRouter";
import { useAIChatActions } from "./AIChatActionsContext";

/**
 * The commit message box, for a project whose settings REQUIRE one.
 *
 * Only that project sees it: by default Publish publishes, with a message the
 * AI writes or one assembled from what changed (`useAutomaticPublish`). So
 * this box exists for a person to read the message and stand behind it, and
 * the three things it used to do to get out of their way are gone:
 *
 * - It is not seeded with a default. A box that arrives full can be published
 *   without reading, which is exactly what "required" is there to prevent. The
 *   default is the placeholder instead: a hint of what one could say.
 * - It never publishes on its own. There is no countdown waiting for the AI; a
 *   person presses Publish, and only when the box has something in it.
 * - The AI still writes one. It fills the box when it arrives — unless the
 *   person has started typing, in which case it is offered rather than
 *   applied — and that is the whole of what it does.
 *
 * Mounting this IS "publish was hit" — the popover only renders when opened —
 * so this is where the AI request starts.
 */
export function PublishSummary({
  onPublish,
  onClose,
  onPress,
}: {
  /** Publish, committing exactly this text. */
  onPublish?: (summary: string) => void;
  onClose: () => void;
  /**
   * The press that publishes. On a page that cannot build this is where the
   * Studio tab is opened: a browser allows a tab only in the press itself.
   */
  onPress?: () => void;
}) {
  const { summary, setSummary, publishDisabled, isPublishing, aiEnabled } =
    usePublishSummary();
  const patchSets = usePatchSets();
  const val = useValSystem();
  const availableModel = useAvailableAIModel();
  // `ai.commitMessages.disabled` in the project's config. Gated after the
  // hook, not around it: a conditional hook call would break the render on the
  // first publish where the config changed.
  const model = aiEnabled ? availableModel : null;
  const { setSessionParam } = useSessionParam();
  const { openAIChat } = useAIChatActions();
  const ai = useCommitSummary(model);

  const defaultMessage = useMemo(
    () =>
      buildDefaultCommitMessage(
        patchSets.status === "success" ? patchSets.data : [],
      ),
    [patchSets],
  );

  /*
   * Every opening starts empty.
   *
   * The summary is persisted, and restored whenever there are pending
   * changes — so without this the box could open already filled, and be
   * published unread: with an earlier visit's AI text, with the default the
   * old flow seeded into every box (stored as `manual`, so it cannot be told
   * from typing), or with a draft written for a publish that has since
   * changed. "Required" means someone reads what goes out, so what goes out
   * is written in this opening. Writing `not-asked` overwrites the stored
   * copy too, which is what stops the restore bringing it back.
   *
   * Until the clear has happened the box reads empty, so a restored value is
   * never on screen even for the one render before the effect.
   */
  const [cleared, setCleared] = useState(false);
  useEffect(() => {
    if (cleared) {
      return;
    }
    setSummary({ type: "not-asked" });
    setCleared(true);
  }, [cleared, setSummary]);
  const value = cleared && "text" in summary ? summary.text : "";

  // Start the AI when the popover opens. The changes go in the prompt as field
  // paths with before/after values — cheaper than a source diff, and the
  // material a summary actually needs.
  useEffect(() => {
    if (val === null || patchSets.status !== "success") {
      return;
    }
    const changes = collectFieldChanges(patchSets.data, val.system.sourceStore);
    // Nothing readable to describe. Sending "No changes." would spend the
    // user's own key to be told what we already know, and then apply the reply.
    if (changes.length === 0) {
      return;
    }
    ai.start(renderChangeDescription(changes));
    // `ai.start`, not `ai`: the hook returns a fresh object every render, so
    // depending on it would re-peek every changed path on each keystroke in the
    // box. `start` changes identity exactly when a retry is worth making — a
    // model arriving, or the socket connecting — and `start` itself latches
    // once it has sent.
  }, [ai.start, patchSets, val]);

  // Applying the AI summary is a separate effect from receiving it so the
  // decision reads off the box as it is now, not as it was when the request was
  // made. It happens at most once — one arrival, one chance to take over, and
  // after that the suggestion is offered rather than applied.
  //
  // The untouched box is the EMPTY one, so that is what it may replace.
  const [hasEdited, setHasEdited] = useState(false);
  const appliedRef = useRef(false);
  useEffect(() => {
    if (appliedRef.current || ai.state.status !== "ready") {
      return;
    }
    appliedRef.current = true;
    if (
      shouldAutoApplyAiSummary({
        hasEdited,
        currentValue: value,
        defaultSummary: "",
      })
    ) {
      setSummary({ type: "ai", text: ai.state.text });
    }
  }, [ai.state, hasEdited, value, setSummary]);

  return (
    <PublishSummaryView
      value={value}
      placeholder={
        ai.state.status === "loading"
          ? "Writing a commit message with AI…"
          : `Describe your changes. For example: ${defaultMessage.split("\n")[0]}`
      }
      onChange={(next) => {
        setHasEdited(true);
        setSummary({ type: "manual", text: next });
      }}
      ai={ai.state}
      onUseAiSummary={() => {
        if (ai.state.status === "ready") {
          setSummary({ type: "ai", text: ai.state.text });
        }
      }}
      onOpenAiSession={
        ai.state.status === "ready" && ai.state.sessionId !== null
          ? () => {
              // Reveal first: the assistant lists visible sessions, so opening
              // it before the server has unhidden this one would show a chat
              // that is not in its own list.
              ai.reveal().then((sessionId) => {
                if (sessionId === null) {
                  return;
                }
                // The assistant reads the session param when it mounts, so
                // setting it before opening is what selects this conversation.
                // A panel already open on another session keeps that one —
                // switching a conversation the user is in the middle of is
                // worse than making them pick this one from the list.
                setSessionParam(sessionId, { replace: true });
                onClose();
                openAIChat();
              });
            }
          : undefined
      }
      onPublish={() => {
        const text = value.trim();
        // The button is disabled on an empty box; this is the same rule for
        // anything that calls it another way.
        if (text === "") {
          return;
        }
        // In the press: see `onPress`.
        onPress?.();
        // Publishing means nobody is going to read the summary session any more.
        ai.cancel();
        onPublish?.(text);
      }}
      onClose={() => {
        ai.cancel();
        onClose();
      }}
      publishDisabled={publishDisabled}
      isPublishing={isPublishing}
    />
  );
}
