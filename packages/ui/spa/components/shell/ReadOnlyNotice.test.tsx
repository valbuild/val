/** @jest-environment jsdom */
// FIRST, and it must stay first: see the note in `testPolyfills`.
import "../../stores/react/testPolyfills";
import { render, renderHook, screen, waitFor } from "@testing-library/react";
import {
  ReadOnlyCard,
  parsePlanAccess,
  readOnlyCopy,
  usePlanAccess,
  type FetchAnswer,
  type PlanAccess,
} from "./ReadOnlyNotice";

/**
 * A Studio whose organization's trial is over, or whose payment failed past
 * its grace, cannot save. It says so before anyone types, with what fixes it:
 * Billing for an owner, the owners by name and a way to write to them for
 * everyone else.
 */
type ReadOnly = Extract<PlanAccess, { access: "read-only" }>;

const readOnly = (over: Partial<ReadOnly> = {}): ReadOnly => ({
  access: "read-only",
  reason: "trial-over",
  billingUrl: "https://admin.val.build/~/acme?section=billing",
  org: "acme",
  canFix: true,
  owners: [{ name: "Kari Nordmann", email: "kari@acme.com" }],
  ...over,
});

describe("the read-only notice", () => {
  test("an owner is sent to Billing to start Pro", () => {
    expect(readOnlyCopy(readOnly())).toEqual({
      title: "This Studio is read-only",
      body: "acme's trial has ended, so nothing can be saved or published until it is on Pro. The site keeps running.",
      action: {
        label: "Start Pro",
        href: "https://admin.val.build/~/acme?section=billing",
        external: true,
      },
    });
    expect(
      readOnlyCopy(readOnly({ reason: "payment-failed" })).action?.label,
    ).toBe("Update payment");
  });

  test("everyone else is told who can fix it, by name, and can write to them", () => {
    const copy = readOnlyCopy(
      readOnly({
        canFix: false,
        owners: [
          { name: "Kari Nordmann", email: "kari@acme.com" },
          { name: "Ola Hansen", email: "ola@acme.com" },
        ],
      }),
    );
    expect(copy.body).toContain(
      "Only an owner of acme can change that: Kari Nordmann and Ola Hansen.",
    );
    expect(copy.action?.label).toBe("Email the owners");
    expect(copy.action?.href).toMatch(
      /^mailto:kari@acme\.com,ola@acme\.com\?subject=/,
    );
  });

  test("the card shows the action as a link", () => {
    render(<ReadOnlyCard access={readOnly()} />);
    const link = screen.getByRole("link", { name: /Start Pro/ });
    expect(link.getAttribute("href")).toBe(
      "https://admin.val.build/~/acme?section=billing",
    );
    expect(
      screen.getByRole("status", { name: "This Studio is read-only" }),
    ).toBeTruthy();
  });

  test("Val Build's answer is checked; anything else is no notice", () => {
    expect(parsePlanAccess({ access: "edit" })).toEqual({ access: "edit" });
    expect(parsePlanAccess(JSON.parse(JSON.stringify(readOnly())))).toEqual(
      readOnly(),
    );
    expect(
      parsePlanAccess({ access: "read-only", reason: "who-knows" }),
    ).toBeNull();
  });
});

describe("asking Val Build", () => {
  const answering = (status: number, body: unknown) => {
    const calls: string[] = [];
    const fetchImpl: FetchAnswer = async (url) => {
      calls.push(url);
      return {
        ok: status >= 200 && status < 300,
        json: async () => body,
      };
    };
    return { calls, fetchImpl };
  };

  test("a connected project asks once, through the proxy", async () => {
    const { calls, fetchImpl } = answering(200, readOnly());
    const { result } = renderHook(() =>
      usePlanAccess("acme/marketing-site", fetchImpl),
    );
    await waitFor(() => expect(result.current).toEqual(readOnly()));
    expect(calls).toEqual([
      "/api/val/admin/proxy/orgs/acme/projects/marketing-site/access",
    ]);
  });

  test("a project that is not connected does not ask, and a failure says nothing", async () => {
    const quiet = answering(200, readOnly());
    renderHook(() => usePlanAccess("Val", quiet.fetchImpl));
    expect(quiet.calls).toEqual([]);
    const failing = answering(502, null);
    const { result } = renderHook(() =>
      usePlanAccess("acme/marketing-site", failing.fetchImpl),
    );
    await waitFor(() => expect(failing.calls).toHaveLength(1));
    expect(result.current).toBeNull();
  });
});
