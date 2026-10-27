/** @jest-environment jsdom */
import { act, renderHook } from "@testing-library/react";
import { useDeploymentStaleTick } from "./useDeploymentStaleTick";
import { DEPLOYMENT_STATUS_UNKNOWN_AFTER_MS } from "../utils/deploymentStatus";

/**
 * The wake-up at the hour.
 *
 * Nothing in the data changes when a deploy goes stale, so without this a
 * surface opened a minute before the line kept saying "deploying" for as long
 * as it stayed open.
 */

const NOW = new Date("2026-08-25T12:00:00Z").getTime();
const minutesAgo = (minutes: number) =>
  new Date(NOW - minutes * 60 * 1000).toISOString();

beforeEach(() => {
  jest.useFakeTimers();
  jest.setSystemTime(NOW);
});
afterEach(() => {
  jest.useRealTimers();
});

test("moves once, just after a building deploy crosses the hour", () => {
  const deployments = [
    { deploymentState: "pending", updatedAt: minutesAgo(59) },
  ];
  const { result } = renderHook(() => useDeploymentStaleTick(deployments));
  expect(result.current).toBe(0);

  act(() => {
    jest.advanceTimersByTime(60 * 1000);
  });
  expect(result.current).toBe(0);

  act(() => {
    jest.advanceTimersByTime(1000);
  });
  expect(result.current).toBe(1);
  expect(
    Date.now() - new Date(deployments[0].updatedAt).getTime(),
  ).toBeGreaterThan(DEPLOYMENT_STATUS_UNKNOWN_AFTER_MS);

  // Nothing is left to cross, so nothing else is scheduled.
  act(() => {
    jest.advanceTimersByTime(24 * 60 * 60 * 1000);
  });
  expect(result.current).toBe(1);
});

test("schedules nothing when no deploy is building", () => {
  const deployments = [
    { deploymentState: "success", updatedAt: minutesAgo(59) },
  ];
  renderHook(() => useDeploymentStaleTick(deployments));
  expect(jest.getTimerCount()).toBe(0);
});
