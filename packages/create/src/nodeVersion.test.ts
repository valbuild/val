import { readFileSync } from "fs";
import { join } from "path";
import { isUnsupportedNodeVersion, minimumNodeVersion } from "../nodeVersion";

function engineRangeOf(json: unknown): string {
  if (
    typeof json === "object" &&
    json !== null &&
    "engines" in json &&
    typeof json.engines === "object" &&
    json.engines !== null &&
    "node" in json.engines &&
    typeof json.engines.node === "string"
  ) {
    return json.engines.node;
  }
  throw new Error("package.json is missing engines.node");
}

// The range this package actually ships, read rather than retyped: a change to
// engines.node is then exercised by these cases instead of drifting past them.
const RANGE = engineRangeOf(
  JSON.parse(readFileSync(join(__dirname, "..", "package.json"), "utf-8")),
);

describe("isUnsupportedNodeVersion", () => {
  test("rejects the Node that produced the ERR_REQUIRE_ESM report", () => {
    // Node 20.11 has no require(esm) at all, so the bundle cannot load.
    expect(isUnsupportedNodeVersion("20.11.0", RANGE)).toBe(true);
  });

  test("accepts the versions engines.node allows", () => {
    expect(isUnsupportedNodeVersion("22.13.0", RANGE)).toBe(false);
    expect(isUnsupportedNodeVersion("22.20.1", RANGE)).toBe(false);
    expect(isUnsupportedNodeVersion("23.5.0", RANGE)).toBe(false);
    expect(isUnsupportedNodeVersion("24.0.0", RANGE)).toBe(false);
    expect(isUnsupportedNodeVersion("26.4.0", RANGE)).toBe(false);
  });

  test("rejects the versions inside the gaps of the range", () => {
    // 22.12 has require(esm), but chalk 6 and @inquirer/prompts 8 do not
    // support it, which is why the floor is 22.13 and not 22.12.
    expect(isUnsupportedNodeVersion("22.12.0", RANGE)).toBe(true);
    // ^22.13.0 does not cover 23.0-23.4, and neither does >=23.5.0.
    expect(isUnsupportedNodeVersion("23.4.0", RANGE)).toBe(true);
  });

  test("treats a prerelease as its release version", () => {
    expect(isUnsupportedNodeVersion("25.0.0-nightly20260101", RANGE)).toBe(
      false,
    );
    expect(isUnsupportedNodeVersion("20.11.0-rc.1", RANGE)).toBe(true);
  });

  test("fails open on anything it cannot parse", () => {
    // A range shape this does not understand must never block a project.
    expect(isUnsupportedNodeVersion("20.11.0", "18 || 20 || >=22")).toBe(false);
    expect(isUnsupportedNodeVersion("20.11.0", "*")).toBe(false);
    expect(isUnsupportedNodeVersion("20.11.0", "")).toBe(false);
    expect(isUnsupportedNodeVersion("nonsense", RANGE)).toBe(false);
  });

  test("uses the clauses it understands and ignores the rest", () => {
    expect(isUnsupportedNodeVersion("20.11.0", "18 || >=22.13.0")).toBe(true);
    expect(isUnsupportedNodeVersion("22.13.0", "18 || >=22.13.0")).toBe(false);
  });
});

describe("minimumNodeVersion", () => {
  test("reports the lowest version any clause allows", () => {
    expect(minimumNodeVersion(RANGE)).toBe("22.13.0");
    expect(minimumNodeVersion(">=23.5.0 || ^22.13.0 || ^20.17.0")).toBe(
      "20.17.0",
    );
  });

  test("is null when no clause parsed", () => {
    expect(minimumNodeVersion("*")).toBe(null);
  });
});
