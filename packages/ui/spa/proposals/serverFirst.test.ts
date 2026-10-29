import { resetServerBuildsForTests, serverFirst } from "./serverFirst";

describe("serverFirst: Val Build builds a proposal before this page does", () => {
  beforeEach(() => resetServerBuildsForTests());

  test("what Val Build answers is the build, and the page builds nothing", async () => {
    const here = jest.fn();
    const outcome = await serverFirst(
      async () => ({ status: "built", hash: "b1", proposal: null as never }),
      here,
    );
    expect(outcome).toMatchObject({ status: "built", hash: "b1" });
    expect(here).not.toHaveBeenCalled();
  });

  test("a failure on Val Build is the build's, not a reason to build here", async () => {
    const here = jest.fn();
    const outcome = await serverFirst(
      async () => ({ status: "failed", message: "SyntaxError" }),
      here,
    );
    expect(outcome).toEqual({ status: "failed", message: "SyntaxError" });
    expect(here).not.toHaveBeenCalled();
  });

  test("a project Val Build does not build is built here, and Val Build is not asked again", async () => {
    const onServer = jest.fn().mockResolvedValue({ status: "off" });
    const here = jest
      .fn()
      .mockResolvedValue({ status: "already-built", hash: null });
    await serverFirst(onServer, here);
    await serverFirst(onServer, here);
    expect(onServer).toHaveBeenCalledTimes(1);
    expect(here).toHaveBeenCalledTimes(2);
  });
});
