import { useEffect, useMemo, useRef, useState } from "react";
import { usePatchSets, usePublishSummary } from "./ValProvider";
import {
  PublishSummaryView,
  usePublishGrace,
  type AiSummaryState,
} from "./PublishSummaryView";
import {
  buildDefaultCommitSummary,
  shouldAutoApplyAiSummary,
} from "./publish/defaultCommitSummary";

/**
 * How long publishing waits for an AI summary that is still being written.
 *
 * Publishing was already asked for, so this is a courtesy, not a gate: it ends
 * either way, and pressing Publish again ends it immediately.
 */
const PUBLISH_GRACE_SECONDS = 10;

/**
 * The publish summary popover.
 *
 * Mounting this IS "publish was hit" — the popover only renders when opened —
 * so this is where the AI request starts, and where the box is seeded with a
 * summary that needed no network call.
 */
export function PublishSummary({
  onPublish,
  onClose,
}: {
  onPublish?: () => void;
  onClose: () => void;
}) {
  const {
    summary,
    setSummary,
    publishDisabled,
    isPublishing,
    generateSummary,
    canGenerate,
  } = usePublishSummary();
  const patchSets = usePatchSets();
  const grace = usePublishGrace(PUBLISH_GRACE_SECONDS);

  const defaultSummary = useMemo(() => {
    const paths =
      patchSets.status === "success"
        ? patchSets.data.map((patchSet) => patchSet.moduleFilePath)
        : [];
    return buildDefaultCommitSummary(paths);
  }, [patchSets]);

  const [ai, setAi] = useState<AiSummaryState>({
    status: canGenerate ? "idle" : "off",
  });
  // Latches on the first keystroke and never clears, so deleting back to the
  // default text does not re-arm the AI's takeover.
  const [hasEdited, setHasEdited] = useState(false);

  const value = "text" in summary ? summary.text : "";

  // Fill the box before anything else happens. An empty publish box is the one
  // state this flow must never be in, because it disables Publish.
  //
  // Ref-guarded rather than keyed off `value`: seeding must happen once, and
  // re-running as the box changes would put the default back the moment the
  // user cleared it to write their own.
  const seededRef = useRef(false);
  useEffect(() => {
    if (seededRef.current) {
      return;
    }
    seededRef.current = true;
    if (value.trim() === "") {
      setSummary({ type: "manual", text: defaultSummary });
    }
  }, [defaultSummary, value, setSummary]);

  // Start the AI when the popover opens, and never block on it.
  const startedRef = useRef(false);
  useEffect(() => {
    if (startedRef.current || !canGenerate) {
      return;
    }
    startedRef.current = true;
    let cancelled = false;
    setAi({ status: "loading" });
    generateSummary().then((result) => {
      if (cancelled) {
        return;
      }
      if (result.type === "ai") {
        const text = result.text.trim();
        setAi({ status: "ready", text, sessionId: null });
      } else {
        setAi({ status: "failed", message: result.message });
      }
    });
    return () => {
      cancelled = true;
    };
  }, [canGenerate, generateSummary]);

  // Applying the AI summary is a separate effect from receiving it so the
  // decision reads off the box as it is now, not as it was when the request was
  // made. It happens at most once — one arrival, one chance to take over, and
  // after that the suggestion is offered rather than applied.
  const appliedRef = useRef(false);
  useEffect(() => {
    if (appliedRef.current || ai.status !== "ready") {
      return;
    }
    appliedRef.current = true;
    if (
      shouldAutoApplyAiSummary({
        hasEdited,
        currentValue: value,
        defaultSummary,
      })
    ) {
      setSummary({ type: "ai", text: ai.text });
    }
  }, [ai, hasEdited, value, defaultSummary, setSummary]);

  // The countdown exists to give the summary a chance to arrive. Once it has —
  // or has failed — there is nothing left to wait for, so go.
  const { isWaiting, skip } = grace;
  useEffect(() => {
    if (!isWaiting) {
      return;
    }
    if (ai.status === "ready" || ai.status === "failed") {
      skip();
    }
  }, [ai.status, isWaiting, skip]);

  const publishNow = () => {
    onPublish?.();
  };

  return (
    <PublishSummaryView
      value={value}
      onChange={(next) => {
        setHasEdited(true);
        setSummary({ type: "manual", text: next });
      }}
      ai={ai}
      onUseAiSummary={() => {
        if (ai.status === "ready") {
          setSummary({ type: "ai", text: ai.text });
        }
      }}
      onPublish={() => {
        // A second press during the countdown skips the rest of it.
        if (grace.isWaiting) {
          grace.skip();
          return;
        }
        // Only worth waiting for if it could still change the text: someone who
        // wrote their own summary is not waiting on a suggestion they will not
        // get.
        const couldStillHelp =
          ai.status === "loading" &&
          shouldAutoApplyAiSummary({
            hasEdited,
            currentValue: value,
            defaultSummary,
          });
        if (couldStillHelp) {
          grace.start(publishNow);
          return;
        }
        publishNow();
      }}
      onClose={() => {
        grace.cancel();
        onClose();
      }}
      publishDisabled={publishDisabled}
      isPublishing={isPublishing}
      waitingForAiSeconds={grace.remaining}
    />
  );
}
