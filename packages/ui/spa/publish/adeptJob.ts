import { StudioPublishError, callJson } from "./callJson";

/*
 * A lockfile or upgrade job on adept, through content's `/adept/*` routes and
 * this deployment's publish proxy (valbuild/home `docs/adept.md`): asked for,
 * then polled until it is done. The Studio's `/val/adept` page and the
 * Upgrade's typecheck, which computes a site's lockfile when it has none on
 * record, both run them.
 */

const proxy = "/api/val/publish-api";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** An answer that is not what the Studio expects: asking again gets the same one. */
export class UnexpectedAnswer extends Error {}

/** The page left, or the same work started again: nobody is waiting for this any more. */
export class Abandoned extends Error {}

/** Waits, unless the work is abandoned first. */
function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) return reject(new Abandoned());
    const timer = setTimeout(() => {
      signal.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      reject(new Abandoned());
    };
    signal.addEventListener("abort", onAbort, { once: true });
  });
}

type JobAnswer = {
  id: number | null;
  state: string;
  step: string | null;
  error: string | null;
  body: Record<string, unknown>;
};

function jobAnswer(value: unknown): JobAnswer {
  if (!isRecord(value) || typeof value["state"] !== "string") {
    throw new UnexpectedAnswer(
      "adept answered with something that is not a job.",
    );
  }
  return {
    id: typeof value["id"] === "number" ? value["id"] : null,
    state: value["state"],
    step: typeof value["step"] === "string" ? value["step"] : null,
    error: typeof value["error"] === "string" ? value["error"] : null,
    body: value,
  };
}

/** How long a job is polled before the page stops waiting for it. */
const JOB_DEADLINE_MS = 15 * 60 * 1000;

/**
 * A lockfile or upgrade job: content waits up to 20 s and then answers with
 * the job, which is polled until it is done. Returns the job's result.
 *
 * Stops when `signal` aborts (the page left, or the work started again),
 * after `JOB_DEADLINE_MS`, and on any state that is not still going -- a
 * state it does not know is not one to wait out.
 */
export async function runJob(
  path: "/adept/lockfile" | "/adept/upgrade",
  body: unknown,
  onProgress: (step: string) => void,
  signal: AbortSignal,
): Promise<Record<string, unknown>> {
  let answer = jobAnswer(
    await callJson(fetch, `${proxy}${path}`, "POST", body),
  );
  if (answer.state === "done") return answer.body;
  const id = answer.id;
  if (id === null) {
    throw new UnexpectedAnswer("adept answered with a job that has no id.");
  }
  const deadline = Date.now() + JOB_DEADLINE_MS;
  for (;;) {
    if (answer.state === "failed" || answer.state === "cancelled") {
      throw new StudioPublishError(422, answer.error ?? answer.state, {
        error: {
          code: answer.state,
          message: answer.error ?? `The job was ${answer.state}.`,
          retryable: false,
        },
      });
    }
    if (answer.state !== "queued" && answer.state !== "running") {
      throw new UnexpectedAnswer(`adept says the job is '${answer.state}'.`);
    }
    if (Date.now() > deadline) {
      throw new StudioPublishError(504, "The job took too long.", {
        error: {
          code: "too-slow",
          message: `adept had not finished after ${JOB_DEADLINE_MS / 60000} minutes, so the page stopped waiting.`,
          retryable: true,
        },
      });
    }
    onProgress(answer.step ?? answer.state);
    await sleep(1000, signal);
    answer = jobAnswer(
      await callJson(fetch, `${proxy}/adept/jobs/${id}`, "GET"),
    );
    if (answer.state === "done") {
      const result = await callJson(
        fetch,
        `${proxy}/adept/jobs/${id}/result`,
        "GET",
      );
      if (!isRecord(result)) {
        throw new UnexpectedAnswer("adept's job finished without a result.");
      }
      return result;
    }
  }
}
