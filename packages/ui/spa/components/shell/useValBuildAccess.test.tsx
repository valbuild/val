/** @jest-environment jsdom */
import { renderHook, waitFor } from "@testing-library/react";

/**
 * Whether the Studio loads Val Build's web components, and how they ask an
 * editor to sign in: always when deployed; on a developer's own checkout only
 * after `val login`; and never by guessing from the stat `mode`, which a
 * deployed memory-mode host reports as `fs`.
 */

const mockClient = jest.fn();
jest.mock("../ValProvider", () => ({
  useClient: () => mockClient,
}));

import { useValBuildAccess } from "./useValBuildAccess";

beforeEach(() => {
  mockClient.mockReset();
});

test("a deployed Studio is connected, signing in through the Studio, without asking", () => {
  const { result } = renderHook(() => useValBuildAccess("http"));
  expect(result.current).toEqual({ connected: true, studioMode: "http" });
  expect(mockClient).not.toHaveBeenCalled();
});

test("local dev with a val login is connected once the server says so", async () => {
  mockClient.mockResolvedValue({
    status: 200,
    json: { connected: true, signIn: "val-login" },
  });
  const { result } = renderHook(() => useValBuildAccess("fs"));
  // Not before: nothing is loaded on a guess.
  expect(result.current.connected).toBe(false);
  await waitFor(() =>
    expect(result.current).toEqual({ connected: true, studioMode: "fs" }),
  );
  expect(mockClient).toHaveBeenCalledWith("/admin/status", "GET", {});
});

test("local dev without a val login stays unconnected", async () => {
  mockClient.mockResolvedValue({
    status: 200,
    json: { connected: false, signIn: "val-login" },
  });
  const { result } = renderHook(() => useValBuildAccess("fs"));
  await waitFor(() => expect(result.current.studioMode).toBe("fs"));
  expect(result.current.connected).toBe(false);
});

test("a deployed memory-mode host reports fs, and still signs in through the Studio", async () => {
  mockClient.mockResolvedValue({
    status: 200,
    json: { connected: false, signIn: "studio" },
  });
  const { result } = renderHook(() => useValBuildAccess("fs"));
  await waitFor(() =>
    expect(result.current).toEqual({ connected: true, studioMode: "http" }),
  );
});

test("an older server that does not say how to sign in is a local checkout", async () => {
  mockClient.mockResolvedValue({ status: 200, json: { connected: true } });
  const { result } = renderHook(() => useValBuildAccess("fs"));
  await waitFor(() =>
    expect(result.current).toEqual({ connected: true, studioMode: "fs" }),
  );
});

test("an older server without the route is not connected", async () => {
  mockClient.mockRejectedValue(new Error("404"));
  const { result } = renderHook(() => useValBuildAccess("fs"));
  await waitFor(() => expect(mockClient).toHaveBeenCalled());
  expect(result.current.connected).toBe(false);
});

test("while the mode is unknown, nothing is asked and nothing is loaded", () => {
  const { result } = renderHook(() => useValBuildAccess("unknown"));
  expect(result.current).toEqual({ connected: false });
  expect(mockClient).not.toHaveBeenCalled();
});
