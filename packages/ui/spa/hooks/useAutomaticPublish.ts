import { useCallback, useEffect, useRef, useState } from "react";
import { useAvailableAIModel } from "../components/ValProvider";
import { useValSystem } from "../stores/react/SystemContext";
import { useCommitSummary } from "./useCommitSummary";
import { buildDefaultCommitMessage } from "../components/publish/defaultCommitSummary";
import { renderChangeDescription } from "../components/publish/changeDescription";
import { collectFieldChanges } from "../components/publish/collectFieldChanges";

/**
 * How long a publish waits for the AI to write its commit message, from the
 * press.
 *
 * Nobody is looking at a box — pressing Publish was the whole of what they
 * asked for — so this is the longest the button may say "Preparing" before it
 * gives up on the model and publishes with the message assembled from what
 * changed. A cap, not a delay: a summary that arrives sooner publishes sooner.
 */
export const AUTOMATIC_SUMMARY_TIMEOUT_MS = 15_000;

export type UseAutomaticPublishResult = {
  /** The AI is writing the message; the publish goes out when it is done. */
  isSummarising: boolean;
  /** Publish now, with a message nobody is asked to write. */
  publishAutomatically: () => void;
};

/**
 * Publishing without asking for a commit message — the default in HTTP mode.
 *
 * With an AI model available the message is the AI's, written from the same
 * before/after values the popover sends; without one, or if it fails or takes
 * too long, it is {@link buildDefaultCommitMessage}, which names the exact
 * paths that changed. Either way the publish happens: the model decides the
 * words, never whether.
 *
 * The patch sets are read at the press rather than subscribed to. The button
 * this lives in is mounted for the whole session, in up to three places, and
 * only ever needs them at the moment it is pressed.
 */
export function useAutomaticPublish({
  publish,
  aiEnabled,
}: {
  publish: (message: string) => void;
  /** `ai.commitMessages.disabled` in the project's config, inverted. */
  aiEnabled: boolean;
}): UseAutomaticPublishResult {
  const val = useValSystem();
  const availableModel = useAvailableAIModel();
  const model = aiEnabled ? availableModel : null;
  const ai = useCommitSummary(model);
  const [isSummarising, setIsSummarising] = useState(false);

  /**
   * The publish that is waiting on the AI, and what to commit if it never
   * answers. A ref, because the answer arrives in an effect of a later render
   * and a timer, neither of which can see the press's closure.
   */
  const pendingRef = useRef<{
    fallback: string;
    /**
     * The prompt went out. Until then the summary state belongs to the LAST
     * publish — a `ready` still sitting there from it must not be read as this
     * one's answer and committed a second time.
     */
    sent: boolean;
  } | null>(null);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const publishRef = useRef(publish);
  publishRef.current = publish;

  const finish = useCallback((text: string) => {
    if (pendingRef.current === null) {
      return;
    }
    pendingRef.current = null;
    if (timeoutRef.current !== null) {
      clearTimeout(timeoutRef.current);
      timeoutRef.current = null;
    }
    setIsSummarising(false);
    publishRef.current(text);
  }, []);

  useEffect(() => {
    const pending = pendingRef.current;
    if (pending === null || !pending.sent) {
      return;
    }
    if (ai.state.status === "ready") {
      finish(ai.state.text);
    } else if (ai.state.status === "failed" || ai.state.status === "off") {
      // `off` too: the model went away mid-request, and nothing will answer.
      finish(pending.fallback);
    }
  }, [ai.state, finish]);

  // Pressing Publish asked for a publish. A button that unmounts while the AI
  // is writing — a resize swapping the top bar for the mobile one — must not
  // quietly drop it.
  useEffect(
    () => () => {
      const pending = pendingRef.current;
      pendingRef.current = null;
      if (timeoutRef.current !== null) {
        clearTimeout(timeoutRef.current);
      }
      if (pending !== null) {
        publishRef.current(pending.fallback);
      }
    },
    [],
  );

  const { reset, start, cancel } = ai;
  const publishAutomatically = useCallback(() => {
    if (pendingRef.current !== null) {
      return;
    }
    if (val === null) {
      publishRef.current(buildDefaultCommitMessage([]));
      return;
    }
    const system = val.system;
    // Claimed before the await, so a second press in the meantime is a no-op
    // rather than a second publish.
    const claim = {
      fallback: buildDefaultCommitMessage([]),
      sent: false,
    };
    pendingRef.current = claim;
    setIsSummarising(model !== null);
    // The deadline runs from the PRESS, not from when the prompt went out:
    // reading the patch sets is part of the wait too, and a read that never
    // settles must not leave the button on "Preparing" for good. The fallback
    // is whatever is known by then — the paths once they have been read, a
    // plain "Update content" if they never were.
    timeoutRef.current = setTimeout(() => {
      timeoutRef.current = null;
      if (pendingRef.current !== claim) {
        return;
      }
      cancel();
      finish(claim.fallback);
    }, AUTOMATIC_SUMMARY_TIMEOUT_MS);
    void system
      .getPatchSets()
      .then((patchSets) => {
        // Another publish, or none: the deadline or an unmount already
        // settled this one, and a later press is not this read's to answer.
        if (pendingRef.current !== claim) {
          return;
        }
        claim.fallback = buildDefaultCommitMessage(patchSets);
        const changes =
          model === null
            ? []
            : collectFieldChanges(patchSets, system.sourceStore);
        // Nothing readable to describe, or nobody to describe it: sending "No
        // changes." would spend the user's own key to be told what we know.
        if (changes.length === 0) {
          finish(claim.fallback);
          return;
        }
        reset();
        if (!start(renderChangeDescription(changes))) {
          finish(claim.fallback);
          return;
        }
        claim.sent = true;
      })
      .catch(() => {
        if (pendingRef.current === claim) {
          finish(claim.fallback);
        }
      });
  }, [cancel, finish, model, reset, start, val]);

  return { isSummarising, publishAutomatically };
}
