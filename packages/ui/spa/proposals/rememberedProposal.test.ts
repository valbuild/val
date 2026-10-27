/** @jest-environment jsdom */
import { readRememberedProposal, rememberProposal } from "./rememberedProposal";

/*
 * The proposal this Studio was in last time at this address, so the next
 * load starts in it rather than waiting for `/stat`.
 */

beforeEach(() => window.localStorage.clear());

test("remembers a proposal, and forgets it on the site", () => {
  expect(readRememberedProposal()).toBeNull();
  rememberProposal({
    name: "a1b2c3d4e5f6a7b8c9d0",
    branch: "val/p/a1b2c3d4e5f6a7b8c9d0",
    displayName: "Spring campaign",
  });
  expect(readRememberedProposal()).toEqual({
    name: "a1b2c3d4e5f6a7b8c9d0",
    branch: "val/p/a1b2c3d4e5f6a7b8c9d0",
    displayName: "Spring campaign",
  });
  rememberProposal(null);
  expect(readRememberedProposal()).toBeNull();
});

test("something else under the key is nothing remembered", () => {
  window.localStorage.setItem("val:proposal-here", "{not json");
  expect(readRememberedProposal()).toBeNull();
  window.localStorage.setItem("val:proposal-here", JSON.stringify({ name: 1 }));
  expect(readRememberedProposal()).toBeNull();
});

test("storage that refuses is waiting for /stat, not an error", () => {
  const getItem = jest
    .spyOn(Storage.prototype, "getItem")
    .mockImplementation(() => {
      throw new Error("SecurityError");
    });
  expect(readRememberedProposal()).toBeNull();
  getItem.mockRestore();
});
