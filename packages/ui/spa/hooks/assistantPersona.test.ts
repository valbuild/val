import {
  assistantPersona,
  CODE_MODE_PERSONA,
  CONTENT_EDITOR_PERSONA,
  isInCodeMode,
} from "./assistantPersona";

describe("who the assistant is told it is talking to", () => {
  test("a content editor is never told about schemas", () => {
    expect(assistantPersona(false)).toBe(CONTENT_EDITOR_PERSONA);
    expect(CONTENT_EDITOR_PERSONA).toContain("they are NOT developers");
  });

  test("in code mode, someone changing code and content together", () => {
    expect(assistantPersona(true)).toBe(CODE_MODE_PERSONA);
    expect(CODE_MODE_PERSONA).not.toContain("NOT developers");
    expect(CODE_MODE_PERSONA).toContain("schema");
  });

  test("code mode is on only in a hosted Studio's proposal that has it on", () => {
    const on = { name: "p1", on: true };
    expect(isInCodeMode(true, "p1", on)).toBe(true);
    expect(isInCodeMode(false, "p1", on)).toBe(false);
    expect(isInCodeMode(true, null, on)).toBe(false);
    expect(isInCodeMode(true, "p2", on)).toBe(false);
    expect(isInCodeMode(true, "p1", { name: "p1", on: false })).toBe(false);
    expect(isInCodeMode(true, "p1", null)).toBe(false);
  });
});
