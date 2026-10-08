/**
 * How long a builder tab waits for content to answer one request. A request
 * can stay pending without ever failing -- a connection the network dropped
 * without a word -- and a tab that waited on it would sit at its step with
 * nothing to show and no retry coming.
 */
export const ANSWER_DEADLINE_MS = 30_000;

/**
 * `call`, or a rejection once `ms` have passed without an answer. Rejected
 * with a plain `Error`, which `isTransientPublishError` counts as no answer
 * at all -- one to ask again.
 *
 * The request itself is not cancelled, only no longer waited for. So this is
 * for calls that are safe to make twice: a press or try again under the same
 * request id (content makes one of it), and reads.
 */
export function withinDeadline<T>(
  call: Promise<T>,
  ms: number = ANSWER_DEADLINE_MS,
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(
      () =>
        reject(
          new Error(`No answer from the content service in ${ms / 1000} s`),
        ),
      ms,
    );
  });
  return Promise.race([call, deadline]).finally(() => clearTimeout(timer));
}
