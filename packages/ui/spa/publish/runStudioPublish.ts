/**
 * Publishing what the tab just built.
 *
 * The same conversation `val publish` has, with the same parsers, and the same
 * shape of state machine -- declare, upload what content does not already hold,
 * confirm, verify, promote. It is written out again here rather than shared
 * with the CLI's `runPublish` because the two differ in every input and in what
 * they do when something goes wrong: the CLI reads artifacts off a disk it
 * controls, takes a token, prints lines and sets an exit code; this holds them
 * in memory, has no credential, and has to leave an EDITOR with something they
 * can act on.
 *
 * What is shared is what must not drift: the wire shapes and their parsers
 * (`@valbuild/shared/internal`) and the artifact key namespace
 * (`@valbuild/tanstack-build`). Those are the parts where a second, slightly
 * different copy is how two publishers come to disagree with one service.
 *
 * ## No progress reporting beyond phases, on purpose
 *
 * Byte-level upload progress would need `XMLHttpRequest` per artifact, and a
 * publish is dozens of small ones rather than one big one -- so what a person
 * sees from counting artifacts is the same and the code is a quarter the size.
 *
 * ## Why it never throws
 *
 * Every exit is a value. A publish that failed has to say WHICH step and leave
 * the commit intact; a thrown error at an await boundary in a React handler is
 * an unhandled rejection and a spinner that never stops.
 */

import type { PublishArtifact } from "@valbuild/tanstack-build";
import {
  parseProblems,
  type DeclareBody,
  type PublishProblem,
} from "@valbuild/shared/internal";
import {
  StudioPublishClient,
  StudioPublishError,
  isExpiredSlot,
} from "./publishClient";

/** Which step the publish is on, for the one line an editor is shown. */
export type PublishPhase =
  | { kind: "declaring" }
  | { kind: "uploading"; done: number; total: number }
  | { kind: "confirming" }
  | { kind: "verifying" }
  | { kind: "promoting" };

export type StudioPublishResult =
  | { status: "live"; publishId: string; url: string | null }
  /** Content had already taken this exact build. Not a failure. */
  | { status: "already-live"; publishId: string; url: string | null }
  | {
      status: "failed";
      /** `null` when it failed before content had accepted anything. */
      publishId: string | null;
      message: string;
      problems: PublishProblem[];
    };

/**
 * How many times to declare again.
 *
 * Declaring mints upload slots, and a slot expires. Three rounds covers an
 * upload that ran past the hour and a storage write that content did not see;
 * a fourth would be the same failure a third time.
 */
const DECLARE_ROUNDS = 3;

export async function runStudioPublish(args: {
  client: StudioPublishClient;
  artifacts: PublishArtifact[];
  declare: DeclareBody;
  onPhase: (phase: PublishPhase) => void;
}): Promise<StudioPublishResult> {
  const { client, artifacts, onPhase } = args;
  const bodyOf = new Map(artifacts.map((a) => [a.key, a.body]));
  let publishId: string | null = null;

  try {
    let confirmed = false;
    for (let round = 1; round <= DECLARE_ROUNDS && !confirmed; round++) {
      onPhase({ kind: "declaring" });
      const declared = await client.declare(args.declare);
      publishId = declared.publishId;

      if (declared.state === "live") {
        /*
         * This exact build is already serving. Re-declaring would mint slots to
         * overwrite the bytes of a live site, so this is a success rather than
         * something to retry -- a second publish of an unchanged build lands
         * here, and so does a retry after a lost response.
         */
        return {
          status: "already-live",
          publishId: declared.publishId,
          url: declared.project.siteUrl,
        };
      }

      const slots = declared.uploads;
      let expired = false;
      for (const [index, slot] of slots.entries()) {
        onPhase({ kind: "uploading", done: index, total: slots.length });
        const body = bodyOf.get(slot.key);
        if (body === undefined) {
          /*
           * Content asked for a key this build does not have. That is the two
           * ends disagreeing about the namespace, which is exactly what
           * `publishArtifacts` exists to prevent -- so it is reported rather
           * than skipped, because skipping produces a publish that confirms and
           * then serves a site with a hole in it.
           */
          return {
            status: "failed",
            publishId,
            message: `Content asked for an artifact this build did not produce: '${slot.key}'.`,
            problems: [],
          };
        }
        try {
          await client.upload(slot, body);
        } catch (error) {
          if (isExpiredSlot(error)) {
            // Not a failure: the hour on the slots ran out while they were
            // being used. Declaring again mints fresh ones.
            expired = true;
            break;
          }
          throw error;
        }
      }
      if (expired) continue;
      onPhase({ kind: "uploading", done: slots.length, total: slots.length });

      onPhase({ kind: "confirming" });
      const confirmation = await client.confirmArtifacts(declared.publishId);
      if (confirmation.state === "awaiting-artifacts") {
        // Content did not see some of what was sent. Another round re-uploads
        // exactly those, because the next declare asks for what is missing.
        if (round === DECLARE_ROUNDS) {
          return {
            status: "failed",
            publishId,
            message: "Some artifacts did not arrive as declared.",
            problems: confirmation.problems,
          };
        }
        continue;
      }
      if (confirmation.state !== "ready") {
        return {
          status: "failed",
          publishId,
          message: `Content left this publish in "${confirmation.state}" after confirming the artifacts.`,
          problems: confirmation.problems,
        };
      }
      confirmed = true;
    }

    if (!confirmed || publishId === null) {
      return {
        status: "failed",
        publishId,
        message: `The artifacts were not confirmed after ${DECLARE_ROUNDS} attempts.`,
        problems: [],
      };
    }

    onPhase({ kind: "verifying" });
    const verified = await client.verify(publishId);
    if (!verified.ok) {
      return {
        status: "failed",
        publishId,
        message:
          "The build was uploaded but did not render, so nothing was published.",
        problems: verified.problems,
      };
    }

    onPhase({ kind: "promoting" });
    const promoted = await client.promote(publishId);
    if (promoted.state !== "live") {
      return {
        status: "failed",
        publishId,
        message: `The site was not moved to this build: it is "${promoted.state}".`,
        problems: [],
      };
    }
    return { status: "live", publishId, url: promoted.url };
  } catch (error) {
    /*
     * One catch for the whole run, because every step fails the same way from
     * an editor's point of view: the commit is saved and the site is not
     * serving it yet. Which step it was is in the message.
     */
    return {
      status: "failed",
      publishId,
      message:
        error instanceof StudioPublishError || error instanceof Error
          ? error.message
          : String(error),
      /*
       * Content refuses with `{ statusCode, message, details }`, and the
       * publish routes put EVERY problem in `details`. Without them the editor
       * reads "This publish cannot be declared" and nothing about why.
       */
      problems:
        error instanceof StudioPublishError ? problemsOf(error.body) : [],
    };
  }
}

/** The problems a refusal carries, or none when its body names none. */
const problemsOf = (body: unknown): PublishProblem[] =>
  typeof body === "object" && body !== null && "details" in body
    ? parseProblems(body.details)
    : [];
