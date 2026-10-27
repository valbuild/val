/**
 * A write Val Build refused because of the project's plan, and the signal that
 * tells the Studio's shell about one.
 *
 * Val Build answers a save, a publish or an upload its plan does not allow
 * with a 403 whose body says why as data (`refusalError` in valbuild/home's
 * `content/src/billing/projectLimits.ts`):
 *
 *     { statusCode: 403, message, error: { code, fix, until?, billingUrl } }
 *
 * Pure and React-free, so the stores and the publish client -- which see the
 * bodies -- can report one without importing the shell that shows it.
 */
import { onPublishRefusal } from "@valbuild/shared/publish";
import { safeHref } from "./safeHref";

/**
 * Why a write was refused. `other` is a code this Studio does not know: a
 * newer Val Build can add one, and it must still be said (with Billing for an
 * owner) rather than dropped while every write is refused.
 */
export type PlanRefusalCode =
  | "trial-over"
  | "payment-failed"
  | "limit:changes"
  | "trial-publishes"
  | "plan:remote-files"
  | "usage:storage"
  /** The organization's read-only refusal (`readOnlyRefusal`). */
  | "read-only"
  | "other";

/** What would make a refusal go away; `other` for one this Studio does not know. */
export type PlanFix =
  | "upgrade"
  | "add-card"
  | "update-payment"
  | "allow-usage"
  | "other";

const CODES: readonly PlanRefusalCode[] = [
  "trial-over",
  "payment-failed",
  "limit:changes",
  "trial-publishes",
  "plan:remote-files",
  "usage:storage",
  "read-only",
];

const FIXES: readonly PlanFix[] = [
  "upgrade",
  "add-card",
  "update-payment",
  "allow-usage",
];

export function planRefusalCodeOf(value: string): PlanRefusalCode {
  return CODES.find((code) => code === value) ?? "other";
}

export function planFixOf(value: unknown): PlanFix {
  return FIXES.find((fix) => fix === value) ?? "other";
}

export const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/** An ISO time, or null for anything that is not one. */
export function isoOrNull(value: unknown): string | null {
  if (typeof value !== "string") return null;
  return Number.isNaN(Date.parse(value)) ? null : value;
}

/** A refused write, as the body of the 403 says it. */
export type PlanRefusal = {
  code: PlanRefusalCode;
  /** The code as sent, kept for a code this Studio does not know. */
  rawCode: string;
  fix: PlanFix;
  /** When it lifts by itself (ISO), if it does. */
  until: string | null;
  /** The organization's Billing in Val Build, if the body named it. */
  billingUrl: string | null;
  /** The server's own sentence, for "Details". */
  message: string | null;
};

/**
 * The refusal in a 403's body, or null for any other body.
 *
 * A plan refusal is told apart from every other 403 (a session that ran out, a
 * nonce that expired) by its `error.code` together with a `billingUrl` or a
 * code this Studio knows: Val Build sends both on every refusal, and nothing
 * else here carries either.
 */
export function parsePlanRefusal(body: unknown): PlanRefusal | null {
  if (!isRecord(body) || !isRecord(body.error)) return null;
  const error = body.error;
  if (typeof error.code !== "string") return null;
  const code = planRefusalCodeOf(error.code);
  // Remote input on its way to an `href`: http(s) only, as every other link
  // Val Build sends (`studioAccess.ts`).
  const billingUrl =
    typeof error.billingUrl === "string"
      ? (safeHref(error.billingUrl) ?? null)
      : null;
  if (code === "other" && billingUrl === null) return null;
  return {
    code,
    rawCode: error.code,
    fix: planFixOf(error.fix),
    until: isoOrNull(error.until),
    billingUrl,
    message: typeof body.message === "string" ? body.message : null,
  };
}

/** The body of an answer as text, parsed if it is JSON; undefined otherwise. */
export function jsonOrUndefined(text: string): unknown {
  if (text === "") return undefined;
  try {
    const parsed: unknown = JSON.parse(text);
    return parsed;
  } catch {
    return undefined;
  }
}

type Listener = (refusal: PlanRefusal) => void;
const listeners = new Set<Listener>();

/**
 * Tell the shell that Val Build refused a write for the plan, if `body` says
 * so. Returns whether it did. Anything else is ignored, so a caller can hand
 * over every failed answer's body without sorting them first.
 */
export function reportPlanRefusal(body: unknown): boolean {
  const refusal = parsePlanRefusal(body);
  if (refusal === null) return false;
  for (const listener of [...listeners]) listener(refusal);
  return true;
}

/** Listen for {@link reportPlanRefusal}. Returns the unsubscribe. */
export function onPlanRefusal(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/*
 * The publish client is `@valbuild/shared/publish`'s, which knows nothing of
 * the shell: the bodies of what it is refused reach the shell through here.
 */
onPublishRefusal((body) => {
  reportPlanRefusal(body);
});
