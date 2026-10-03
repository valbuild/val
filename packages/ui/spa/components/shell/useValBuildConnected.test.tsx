/** @jest-environment jsdom */
import { renderHook, waitFor } from "@testing-library/react";

/**
 * Whether the Studio loads Val Build's web components: always when deployed,
 * and in local development only after `val login` — so a developer who never
 * logged in sees the plain project name, not a component saying they are not
 * logged in.
 */

const mockClient = jest.fn();
jest.mock("../ValProvider", () => ({
  useClient: () => mockClient,
}));

import { useValBuildConnected } from "./useValBuildConnected";

beforeEach(() => {
  mockClient.mockReset();
});

test("a deployed Studio is connected, without asking", () => {
  const { result } = renderHook(() => useValBuildConnected("http"));
  expect(result.current).toBe(true);
  expect(mockClient).not.toHaveBeenCalled();
});

test("local dev with a val login is connected once the server says so", async () => {
  mockClient.mockResolvedValue({ status: 200, json: { connected: true } });
  const { result } = renderHook(() => useValBuildConnected("fs"));
  // Not before: nothing is loaded on a guess.
  expect(result.current).toBe(false);
  await waitFor(() => expect(result.current).toBe(true));
  expect(mockClient).toHaveBeenCalledWith("/admin/status", "GET", {});
});

test("local dev without a val login stays unconnected", async () => {
  mockClient.mockResolvedValue({ status: 200, json: { connected: false } });
  const { result } = renderHook(() => useValBuildConnected("fs"));
  await waitFor(() => expect(mockClient).toHaveBeenCalled());
  expect(result.current).toBe(false);
});

test("an older server without the route is not connected", async () => {
  mockClient.mockRejectedValue(new Error("404"));
  const { result } = renderHook(() => useValBuildConnected("fs"));
  await waitFor(() => expect(mockClient).toHaveBeenCalled());
  expect(result.current).toBe(false);
});

test("while the mode is unknown, nothing is asked and nothing is loaded", () => {
  const { result } = renderHook(() => useValBuildConnected("unknown"));
  expect(result.current).toBe(false);
  expect(mockClient).not.toHaveBeenCalled();
});
