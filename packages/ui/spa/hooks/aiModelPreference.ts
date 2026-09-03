import { AIModel } from "./useAIWebSocket";

/**
 * Which model this editor last chose.
 *
 * Deliberately behind two functions and nothing else. Val is growing a settings
 * surface, and when it arrives this preference belongs in it — at which point
 * this module is the only thing that changes, and every caller keeps working.
 *
 * Per browser for now, which is the honest scope of what a `localStorage` value
 * means: a convenience on one machine, not a setting that follows you.
 */
const STORAGE_KEY = "val:ai:model";

/**
 * Reading and writing storage can throw outright — a private window, a browser
 * set to block site data — so neither is allowed to take the assistant down
 * with it. Failing to remember a preference is not worth an error boundary.
 */
export function readPreferredModel(): AIModel | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      return null;
    }
    // Validated, not cast. What is in storage was written by some earlier
    // version of this code and is untrusted like anything else read back from
    // the world: a provider this build cannot drive must not be handed on as
    // an `AIModel`, and a rebuilt object leaves any extra fields behind.
    const parsed = AIModel.safeParse(JSON.parse(raw));
    return parsed.success
      ? { provider: parsed.data.provider, model: parsed.data.model }
      : null;
  } catch {
    return null;
  }
}

export function writePreferredModel(model: AIModel): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(model));
  } catch {
    // Nothing to do and nothing worth saying: the picker still works, it just
    // will not be remembered next time.
  }
}

/**
 * The model to start on, given what the provider says is available.
 *
 * A remembered choice only counts if it is still offered — an account can lose
 * access to a model, or a key can be swapped for one on a different tier, and
 * silently sending a model the provider will refuse is worse than quietly
 * moving to one it accepts.
 */
export function resolvePreferredModel(
  available: AIModel[],
  fallback: AIModel | null,
): AIModel | null {
  if (available.length === 0) {
    return fallback;
  }
  const preferred = readPreferredModel();
  const stillOffered =
    preferred &&
    available.find(
      (entry) =>
        entry.provider === preferred.provider &&
        entry.model === preferred.model,
    );
  if (stillOffered) {
    return stillOffered;
  }
  const fallbackOffered =
    fallback &&
    available.find(
      (entry) =>
        entry.provider === fallback.provider && entry.model === fallback.model,
    );
  return fallbackOffered ?? available[0];
}
