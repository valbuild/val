import { ModuleFilePath, SourcePath } from "@valbuild/core";
import { ValidateSession } from "./validateSession";

const MODULE = "/content/media.val.ts" as ModuleFilePath;
const at = (field: string) => `${MODULE}?p="${field}"` as SourcePath;
const DOWN = "https://down.example.com";
const OTHER = "https://other.example.com";

describe("ValidateSession.retryHost", () => {
  const sessionAfterRun = () => {
    const session = new ValidateSession();
    session.start([MODULE]);
    session.recordModule(MODULE, {
      status: "ok",
      errors: {
        // Fixed since the run: its row has an Undo that must survive.
        [at("hero")]: [{ message: "Stale", fixes: ["image:check-remote"] }],
      },
      remoteHosts: [
        {
          host: DOWN,
          status: "unreachable",
          details: "ECONNREFUSED",
          sourcePaths: [at("a"), at("b")],
        },
        {
          host: OTHER,
          status: "unreachable",
          details: "timeout",
          sourcePaths: [at("c")],
        },
      ],
    });
    session.finish(0);
    return session;
  };

  test("takes only what the host's files answered, and keeps the rest of the run", () => {
    const session = sessionAfterRun();
    session.retryHost(MODULE, DOWN, {
      status: "ok",
      // The module re-checked with the fix applied: `hero` is no longer
      // stale, `a` is back and fine, `b` is back and gone.
      errors: { [at("b")]: [{ message: "404" }] },
      remoteHosts: [
        // Still down, but not the host that was retried.
        {
          host: OTHER,
          status: "unreachable",
          details: "timeout again",
          sourcePaths: [at("c")],
        },
      ],
    });
    expect(session.getSnapshot().results.get(MODULE)).toEqual({
      status: "ok",
      errors: {
        [at("hero")]: [{ message: "Stale", fixes: ["image:check-remote"] }],
        [at("b")]: [{ message: "404" }],
      },
      remoteHosts: [
        {
          host: OTHER,
          status: "unreachable",
          details: "timeout",
          sourcePaths: [at("c")],
        },
      ],
    });
  });

  test("a host still down is still listed", () => {
    const session = sessionAfterRun();
    session.retryHost(MODULE, DOWN, {
      status: "ok",
      errors: {},
      remoteHosts: [
        {
          host: DOWN,
          status: "unreachable",
          details: "ECONNREFUSED again",
          sourcePaths: [at("a"), at("b")],
        },
      ],
    });
    const result = session.getSnapshot().results.get(MODULE);
    expect(result?.status === "ok" && result.remoteHosts).toEqual([
      expect.objectContaining({ host: OTHER }),
      expect.objectContaining({ host: DOWN, details: "ECONNREFUSED again" }),
    ]);
  });

  test("does not count as progress of a run", () => {
    const session = new ValidateSession();
    session.start([MODULE, "/b.val.ts" as ModuleFilePath]);
    session.recordModule(MODULE, { status: "ok", errors: {}, remoteHosts: [] });
    session.retryHost(MODULE, DOWN, {
      status: "ok",
      errors: {},
      remoteHosts: [],
    });
    expect(session.getSnapshot().run).toMatchObject({
      status: "running",
      checked: 1,
    });
  });
});
