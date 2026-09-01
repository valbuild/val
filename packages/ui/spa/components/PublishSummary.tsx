import { useEffect, useMemo, useRef, useState } from "react";
import type { ModuleFilePath } from "@valbuild/core";
import { Internal } from "@valbuild/core";
import { usePatchSets, usePublishSummary } from "./ValProvider";
import { useValSystem } from "../stores/react/SystemContext";
import { PublishSummaryView, usePublishGrace } from "./PublishSummaryView";
import {
  buildDefaultCommitSummary,
  shouldAutoApplyAiSummary,
} from "./publish/defaultCommitSummary";
import {
  renderChangeDescription,
  type FieldChange,
} from "./publish/changeDescription";
import { useCommitSummary } from "../hooks/useCommitSummary";
import { useAvailableAIModel } from "./ValProvider";
import { useSessionParam } from "./ValRouter";
import { useAIChatActions } from "./AIChatActionsContext";

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
  const { summary, setSummary, publishDisabled, isPublishing } =
    usePublishSummary();
  const patchSets = usePatchSets();
  const val = useValSystem();
  const model = useAvailableAIModel();
  const grace = usePublishGrace(PUBLISH_GRACE_SECONDS);
  const { setSessionParam } = useSessionParam();
  const { openAIChat } = useAIChatActions();
  const ai = useCommitSummary(model);

  const changedModules = useMemo<ModuleFilePath[]>(
    () =>
      patchSets.status === "success"
        ? patchSets.data.map((patchSet) => patchSet.moduleFilePath)
        : [],
    [patchSets],
  );
  const defaultSummary = useMemo(
    () => buildDefaultCommitSummary(changedModules),
    [changedModules],
  );

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

  // Start the AI when the popover opens, and never block on it. The changes go
  // in the prompt as field paths with before/after values — cheaper than a
  // source diff, and the material a summary actually needs.
  const startedRef = useRef(false);
  useEffect(() => {
    if (startedRef.current || val === null || patchSets.status !== "success") {
      return;
    }
    startedRef.current = true;
    const store = val.system.sourceStore;
    const changes: FieldChange[] = [];
    for (const patchSet of patchSets.data) {
      const sourcePath = Internal.joinModuleFilePathAndModulePath(
        patchSet.moduleFilePath,
        Internal.patchPathToModulePath(patchSet.patchPath),
      );
      const after = store.peek(sourcePath);
      const before = store.peekBase(sourcePath);
      // A value still loading is unknown, not unchanged. Skipping it is better
      // than telling the model something that is not so.
      if (after.status !== "ready" || before.status !== "ready") {
        continue;
      }
      changes.push({
        sourcePath,
        moduleFilePath: patchSet.moduleFilePath,
        fieldPath: patchSet.patchPath.join("."),
        schemaType: patchSet.schemaTypes[0],
        before: before.data,
        after: after.data,
      });
    }
    ai.start(renderChangeDescription(changes));
  }, [ai, patchSets, val]);

  // Applying the AI summary is a separate effect from receiving it so the
  // decision reads off the box as it is now, not as it was when the request was
  // made. It happens at most once — one arrival, one chance to take over, and
  // after that the suggestion is offered rather than applied.
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
        defaultSummary,
      })
    ) {
      setSummary({ type: "ai", text: ai.state.text });
    }
  }, [ai.state, hasEdited, value, defaultSummary, setSummary]);

  // The countdown exists to give the summary a chance to arrive. Once it has —
  // or has failed — there is nothing left to wait for, so go.
  const { isWaiting, skip } = grace;
  useEffect(() => {
    if (!isWaiting) {
      return;
    }
    if (ai.state.status === "ready" || ai.state.status === "failed") {
      skip();
    }
  }, [ai.state.status, isWaiting, skip]);

  const publishNow = () => {
    // Publishing means nobody is going to read the summary session any more.
    ai.cancel();
    onPublish?.();
  };

  return (
    <PublishSummaryView
      value={value}
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
        // A second press during the countdown skips the rest of it.
        if (grace.isWaiting) {
          grace.skip();
          return;
        }
        // Only worth waiting for if it could still change the text: someone who
        // wrote their own summary is not waiting on a suggestion they will not
        // get.
        const couldStillHelp =
          ai.state.status === "loading" &&
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
        ai.cancel();
        onClose();
      }}
      publishDisabled={publishDisabled}
      isPublishing={isPublishing}
      waitingForAiSeconds={grace.remaining}
    />
  );
}
