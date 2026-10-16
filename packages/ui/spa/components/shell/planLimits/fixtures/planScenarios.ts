import {
  parsePlanRefusal,
  type PlanRefusal,
} from "../../../../utils/planRefusal";
import { parseStudioAccess, type StudioAccess } from "../studioAccess";
import {
  ACCESS_FIXTURES,
  REFUSED_FIXTURES,
  studioAccessBody,
  type AccessFixture,
} from "./planFixtures";

/**
 * Every plan state the Studio has something to say about, for stories: an
 * `/access` answer from the fixtures, and -- where the state is a write that
 * was just refused -- the 403 that refused it.
 */
export const PLAN_SCENARIOS = {
  "hosted-trial": { access: "access-hosted-trial" },
  "hosted-trial-with-card": { access: "access-hosted-trial-with-card" },
  "hosted-trial-publishes-used": {
    access: "access-hosted-trial-publishes-used",
  },
  "hosted-trial-over": { access: "access-hosted-trial-over" },
  "hosted-usage-warn": { access: "access-hosted-usage-warn", warnOnly: true },
  "hosted-usage-out": { access: "access-hosted-usage-warn" },
  "hosted-storage-used-up": {
    access: "access-hosted-converted",
    refused: "refused-usage-storage",
  },
  "free-warn": { access: "access-free-warn" },
  "free-at-limit": { access: "access-free-at-limit" },
  "free-remote-files": {
    access: "access-free",
    refused: "refused-plan-remote-files",
  },
  "payment-failed": { access: "access-pro-payment-failed" },
} satisfies Record<
  string,
  {
    access: AccessFixture;
    refused?: keyof typeof REFUSED_FIXTURES;
    /** The month's warning alone: nothing has run out yet. */
    warnOnly?: true;
  }
>;

export type PlanScenario = keyof typeof PLAN_SCENARIOS;

/** The moment valbuild/home generated the fixtures at, so their dates read right. */
export const PLAN_FIXTURES_NOW = new Date("2026-10-09T12:00:00Z");

export function planScenario(
  name: PlanScenario,
  who: "owner" | "editor",
): { access: StudioAccess | null; refusal: PlanRefusal | null } {
  const scenario: {
    access: AccessFixture;
    refused?: keyof typeof REFUSED_FIXTURES;
    warnOnly?: true;
  } = PLAN_SCENARIOS[name];
  const body = studioAccessBody(scenario.access, who);
  const limits = ACCESS_FIXTURES[scenario.access];
  return {
    access: parseStudioAccess(
      scenario.warnOnly && limits.usage !== null
        ? {
            ...body,
            limits: { ...limits, usage: { ...limits.usage, out: [] } },
          }
        : body,
    ),
    refusal:
      scenario.refused === undefined
        ? null
        : parsePlanRefusal(REFUSED_FIXTURES[scenario.refused]),
  };
}
