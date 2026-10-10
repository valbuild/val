import { useEffect, useState } from "react";
import { ExternalLink, Lock, Mail } from "lucide-react";
import { cn } from "../designSystem/cn";
import { ADMIN_PROXY } from "./ProjectSwitcher";
import { orgOfProject } from "./ProjectMembersButton";

/**
 * The Studio is read-only: the organization's trial is over, or a payment
 * failed and its grace is over. Val Build refuses every save, file and
 * publish until it is fixed (`content/src/billing/planAccess.ts` in
 * valbuild/home); the site itself keeps running.
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
      reason: "trial-over" | "payment-failed";
      billingUrl: string;
      org: string;
      /** The person asking is an owner, who can fix it. */
      canFix: boolean;
      owners: { name: string; email: string }[];
    };

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

export function parsePlanAccess(json: unknown): PlanAccess | null {
  if (!isRecord(json)) return null;
  if (json.access === "edit") return { access: "edit" };
  if (
    json.access !== "read-only" ||
    !(json.reason === "trial-over" || json.reason === "payment-failed") ||
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
    reason: json.reason,
    billingUrl: json.billingUrl,
    org: json.org,
    canFix: json.canFix,
    owners,
  };
}

/**
 * Whether this project's Studio can edit, asked of Val Build once, through
 * this app's proxy. Null until it answers, and for a project that is not
 * connected; a failed ask is null too, because the save itself is refused
 * with the reason, and a notice that guesses is worse than none.
 */
/** What `usePlanAccess` needs of `fetch`: tests pass their own. */
export type FetchAnswer = (
  url: string,
  init: { headers: Record<string, string>; signal: AbortSignal },
) => Promise<{ ok: boolean; json(): Promise<unknown> }>;

export function usePlanAccess(
  projectName: string | undefined,
  fetchImpl: FetchAnswer = fetch,
): PlanAccess | null {
  const [access, setAccess] = useState<PlanAccess | null>(null);
  const org = projectName === undefined ? null : orgOfProject(projectName);
  const name = projectName?.split("/")[1];
  useEffect(() => {
    if (org === null || name === undefined) return;
    const controller = new AbortController();
    fetchImpl(
      `${ADMIN_PROXY}/orgs/${encodeURIComponent(org)}/projects/${encodeURIComponent(name)}/access`,
      { headers: { "x-val-studio": "1" }, signal: controller.signal },
    )
      .then((response) => (response.ok ? response.json() : null))
      .then((json: unknown) => setAccess(parsePlanAccess(json)))
      .catch(() => undefined);
    return () => controller.abort();
  }, [org, name, fetchImpl]);
  return access;
}

type Copy = {
  title: string;
  body: string;
  action: { label: string; href: string; external: boolean } | null;
};

function names(owners: { name: string }[]): string {
  const list = owners.map((owner) => owner.name);
  if (list.length <= 1) return list[0] ?? "";
  return `${list.slice(0, -1).join(", ")} and ${list[list.length - 1]}`;
}

export function readOnlyCopy(
  access: Extract<PlanAccess, { access: "read-only" }>,
): Copy {
  const why =
    access.reason === "trial-over"
      ? `${access.org}'s trial has ended, so nothing can be saved or published until it is on Pro.`
      : `A payment for ${access.org} failed, so nothing can be saved or published until it is paid.`;
  const body = `${why} The site keeps running.`;
  if (access.canFix) {
    return {
      title: "This Studio is read-only",
      body,
      action: {
        label: access.reason === "trial-over" ? "Start Pro" : "Update payment",
        href: access.billingUrl,
        external: true,
      },
    };
  }
  const owners = access.owners;
  const subject = encodeURIComponent(
    access.reason === "trial-over"
      ? `Can ${access.org} move to Pro? The Studio is read-only`
      : `${access.org}'s payment failed: the Studio is read-only`,
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

export function ReadOnlyCard({
  access,
}: {
  access: Extract<PlanAccess, { access: "read-only" }>;
}) {
  const copy = readOnlyCopy(access);
  return (
    <section
      role="status"
      aria-label={copy.title}
      className="relative rounded-lg border bg-bg-tertiary p-4"
    >
      <div className="flex gap-3">
        <Lock size={16} className="mt-0.5 shrink-0 text-fg-error-on-surface" />
        <div className="min-w-0">
          <p className="text-sm font-medium text-fg-error-on-surface">
            {copy.title}
          </p>
          <p className="mt-1 text-xs text-fg-secondary">{copy.body}</p>
          {copy.action !== null && (
            <a
              href={copy.action.href}
              target={copy.action.external ? "_blank" : undefined}
              rel={copy.action.external ? "noreferrer" : undefined}
              className={cn(
                "mt-3 inline-flex h-7 items-center gap-1.5 rounded-md px-2.5 text-xs font-medium",
                "border border-border-primary text-fg-primary hover:bg-bg-float-raised",
              )}
            >
              {copy.action.external ? null : <Mail size={12} />}
              {copy.action.label}
              {copy.action.external ? <ExternalLink size={12} /> : null}
            </a>
          )}
        </div>
      </div>
    </section>
  );
}
