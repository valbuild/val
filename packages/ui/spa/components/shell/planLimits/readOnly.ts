import { isRecord } from "../../../utils/planRefusal";

/**
 * The Studio is read-only: a payment failed and its grace is over. Val Build
 * refuses every save, file and publish until it is paid
 * (`content/src/billing/planAccess.ts` in valbuild/home); the site itself
 * keeps running. This is the ORGANIZATION's half of `/access`; the project's
 * own plan is `limits` beside it (see `studioAccess.ts`).
 *
 * Said once, above the editor, before anyone types something that cannot be
 * saved, with what fixes it next to it: Billing for an owner, and for
 * everyone else the owners by name and a way to write to them. It cannot be
 * dismissed: it stays true until the plan changes.
 */
export type PlanAccess =
  | { access: "edit" }
  | {
      access: "read-only";
      /**
       * A failed payment, the one reason Val Build gives today; `other` for
       * one this Studio does not know, which is still said, as every save is
       * refused all the same.
       */
      reason: "payment-failed" | "other";
      billingUrl: string;
      org: string;
      /** The person asking is an owner, who can fix it. */
      canFix: boolean;
      owners: { name: string; email: string }[];
    };

export type ReadOnlyAccess = Extract<PlanAccess, { access: "read-only" }>;

export function parsePlanAccess(json: unknown): PlanAccess | null {
  if (!isRecord(json)) return null;
  if (json.access === "edit") return { access: "edit" };
  if (
    json.access !== "read-only" ||
    typeof json.reason !== "string" ||
    typeof json.billingUrl !== "string" ||
    typeof json.org !== "string" ||
    typeof json.canFix !== "boolean" ||
    !Array.isArray(json.owners)
  ) {
    return null;
  }
  const owners: { name: string; email: string }[] = [];
  for (const owner of json.owners) {
    if (
      !isRecord(owner) ||
      typeof owner.name !== "string" ||
      typeof owner.email !== "string"
    ) {
      return null;
    }
    owners.push({ name: owner.name, email: owner.email });
  }
  return {
    access: "read-only",
    reason: json.reason === "payment-failed" ? "payment-failed" : "other",
    billingUrl: json.billingUrl,
    org: json.org,
    canFix: json.canFix,
    owners,
  };
}

export type ReadOnlyCopy = {
  title: string;
  body: string;
  action: { label: string; href: string; external: boolean } | null;
};

/** "Kari", "Kari and Ola", "Kari, Ola and Per". */
export function names(owners: { name: string }[]): string {
  const list = owners.map((owner) => owner.name);
  if (list.length <= 1) return list[0] ?? "";
  return `${list.slice(0, -1).join(", ")} and ${list[list.length - 1]}`;
}

export function readOnlyCopy(access: ReadOnlyAccess): ReadOnlyCopy {
  const paymentFailed = access.reason === "payment-failed";
  const why = paymentFailed
    ? `A payment for ${access.org} failed, so nothing can be saved or published until it is paid.`
    : `${access.org}'s Studio is read-only, so nothing can be saved or published.`;
  const body = `${why} The site keeps running.`;
  if (access.canFix) {
    return {
      title: "This Studio is read-only",
      body,
      action: {
        label: paymentFailed ? "Update payment" : "Open Billing",
        href: access.billingUrl,
        external: true,
      },
    };
  }
  const owners = access.owners;
  const subject = encodeURIComponent(
    paymentFailed
      ? `${access.org}'s payment failed: the Studio is read-only`
      : `${access.org}'s Studio is read-only`,
  );
  return {
    title: "This Studio is read-only",
    body:
      owners.length === 0
        ? `${body} Only an owner of ${access.org} can change that.`
        : `${body} Only an owner of ${access.org} can change that: ${names(owners)}.`,
    action:
      owners.length === 0
        ? null
        : {
            label:
              owners.length === 1
                ? `Email ${owners[0]?.name}`
                : "Email the owners",
            href: `mailto:${owners.map((owner) => owner.email).join(",")}?subject=${subject}`,
            external: false,
          },
  };
}
