/** @jest-environment jsdom */
import "../../../stores/react/testPolyfills";
import type { ReactNode } from "react";
import { renderHook } from "@testing-library/react";
import type { PatchId } from "@valbuild/core";
import { createSystem } from "../../../stores/createSystem";
import { ValSystemProvider } from "../../../stores/react/SystemContext";
import { parseStudioAccess, type StudioAccess } from "./studioAccess";
import { studioAccessBody, type AccessFixture } from "./fixtures/planFixtures";
import { editAllowed, useResumeRefusedSaves } from "./useResumeRefusedSaves";

/**
 * Held saves go up when Val Build says editing has OPENED -- and only then.
 *
 * Resuming on every answer that allows editing looped: a save refused while
 * `/access` still said yes (asked a moment before the 1,000th change) reported
 * the refusal, which asked `/access` again, which said yes, which resumed, and
 * the save was refused again, every couple of seconds.
 */
const accessOf = (state: AccessFixture): StudioAccess => {
  const access = parseStudioAccess(studioAccessBody(state, "owner"));
  if (access === null) throw new Error(`${state} did not parse`);
  return access;
};

function mount() {
  const system = createSystem({
    fetchPatches: async () => ({ patches: [] }),
    createPatchId: () => "p" as PatchId,
  });
  const resume = jest.spyOn(system.patchSync, "resume");
  const wrapper = ({ children }: { children: ReactNode }) => (
    <ValSystemProvider system={system}>{children}</ValSystemProvider>
  );
  const initialProps: { access: StudioAccess | null } = { access: null };
  const hook = renderHook(
    ({ access }: { access: StudioAccess | null }) =>
      useResumeRefusedSaves(access),
    { wrapper, initialProps },
  );
  return { system, resume, hook };
}

describe("resuming saves a plan refusal held back", () => {
  it("resumes when editing changes from refused to allowed", () => {
    const { system, resume, hook } = mount();
    hook.rerender({ access: accessOf("access-free-at-limit") });
    expect(resume).not.toHaveBeenCalled();

    hook.rerender({ access: accessOf("access-pro") });
    expect(resume).toHaveBeenCalledTimes(1);
    system.dispose();
  });

  it("does not resume again on another answer that still allows it", () => {
    const { system, resume, hook } = mount();
    hook.rerender({ access: accessOf("access-free-at-limit") });
    hook.rerender({ access: accessOf("access-pro") });
    hook.rerender({ access: accessOf("access-pro") });
    expect(resume).toHaveBeenCalledTimes(1);
    system.dispose();
  });

  it("does not resume on the first answer: nothing was refused yet that it knows of", () => {
    const { system, resume, hook } = mount();
    hook.rerender({ access: accessOf("access-free") });
    expect(resume).not.toHaveBeenCalled();
    system.dispose();
  });
});

describe("editAllowed", () => {
  it("is false while Val Build has not answered", () => {
    expect(editAllowed(null)).toBe(false);
  });

  it("is false when the plan refuses the edit or the organization is read-only", () => {
    expect(editAllowed(accessOf("access-free-at-limit"))).toBe(false);
    expect(editAllowed(accessOf("access-hosted-trial-over"))).toBe(false);
    expect(editAllowed(accessOf("access-pro-payment-failed"))).toBe(false);
  });

  it("is true when nothing refuses it", () => {
    expect(editAllowed(accessOf("access-free"))).toBe(true);
    expect(editAllowed(accessOf("access-hosted-trial-publishes-used"))).toBe(
      true,
    );
  });
});
