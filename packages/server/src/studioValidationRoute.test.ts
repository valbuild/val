import fs from "fs";
import os from "os";
import path from "path";
import { initVal, modules } from "@valbuild/core";
import { createValApiRouter, createValServer } from "./ValRouter";
import { encodeJwt } from "./jwt";
import { fakeRequest } from "./fakeRequest";

// A 1×1 PNG.
const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABAQAAAAA3bvkkAAAACklEQVR4AWNgAAAAAgABc3UBGAAAAABJRU5ErkJggg==",
  "base64",
);

/**
 * `/validate` and `/validate/fix` through the router: the request shapes, the
 * statuses a caller has to handle, and who may call them. What the check finds
 * is `studioValidation.test.ts`'s.
 */
describe("/validate and /validate/fix", () => {
  const route = "/api/val";
  const { c, s, config } = initVal();
  const PAGE = "/content/page.val.ts";
  let root: string;

  const makeRoute = (options: Record<string, unknown>) =>
    createValApiRouter(
      route,
      createValServer(
        modules(config, [
          {
            def: () =>
              Promise.resolve({
                default: c.define(PAGE, s.object({ hero: s.image() }), {
                  hero: {
                    path: "/public/val/hero.png",
                    width: 8,
                    height: 8,
                    mimeType: "image/png",
                  },
                }),
              }),
          },
        ]),
        route,
        { disableCache: true, ...options },
        config,
        {
          async isEnabled() {
            return true;
          },
          async onDisable() {},
          async onEnable() {},
        },
      ),
      (res) => res,
    );

  const post = (
    onRoute: ReturnType<typeof makeRoute>,
    subPath: string,
    json: unknown,
    headers = new Headers({ Cookie: `val_session=${encodeJwt({}, "")}` }),
  ) =>
    onRoute(
      fakeRequest({
        method: "POST",
        url: new URL(`http://localhost:3000${route}${subPath}`),
        json,
        headers,
      }),
    );

  let cwd: jest.SpyInstance;
  /** The body of an answer, if it had one: `ValServerGenericResult` may not. */
  const bodyOf = (res: Awaited<ReturnType<typeof post>>): unknown =>
    "json" in res ? res.json : undefined;

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "val-validate-route-"));
    // fs mode serves the project in the working directory; there is no option
    // to point it elsewhere.
    cwd = jest.spyOn(process, "cwd").mockReturnValue(root);
    fs.mkdirSync(path.join(root, "public/val"), { recursive: true });
    fs.writeFileSync(path.join(root, "public/val/hero.png"), PNG);
    fs.mkdirSync(path.join(root, "content"), { recursive: true });
    fs.writeFileSync(path.join(root, PAGE), "");
  });

  afterEach(() => {
    cwd.mockRestore();
    fs.rmSync(root, { recursive: true, force: true });
  });

  test("/validate reports one module's errors", async () => {
    const res = await post(makeRoute({}), "/validate", {
      moduleFilePath: PAGE,
      patchIds: [],
    });
    expect(res.status).toBe(200);
    expect(bodyOf(res)).toEqual({
      moduleFilePath: PAGE,
      errors: {
        [`${PAGE}?p="hero"."height"`]: [
          expect.objectContaining({ fixes: ["image:check-metadata"] }),
        ],
        [`${PAGE}?p="hero"."width"`]: [
          expect.objectContaining({ fixes: ["image:check-metadata"] }),
        ],
      },
    });
  });

  test("/validate/fix answers with the patch, and applies nothing", async () => {
    const onRoute = makeRoute({});
    const res = await post(onRoute, "/validate/fix", {
      moduleFilePath: PAGE,
      sourcePath: `${PAGE}?p="hero"."width"`,
      fix: "image:check-metadata",
      patchIds: [],
    });
    expect(res.status).toBe(200);
    expect(bodyOf(res)).toEqual({
      patch: [
        { op: "add", path: ["hero", "width"], value: 1 },
        { op: "add", path: ["hero", "height"], value: 1 },
      ],
      remainingErrors: [],
    });
    // Still wrong: the patch is the Studio's to add as a pending change.
    const again = await post(onRoute, "/validate", {
      moduleFilePath: PAGE,
      patchIds: [],
    });
    expect(bodyOf(again)).toEqual({
      moduleFilePath: PAGE,
      errors: {
        [`${PAGE}?p="hero"."height"`]: expect.anything(),
        [`${PAGE}?p="hero"."width"`]: expect.anything(),
      },
    });
  });

  test("a module that does not exist is a 404", async () => {
    const res = await post(makeRoute({}), "/validate", {
      moduleFilePath: "/content/nope.val.ts",
    });
    expect(res.status).toBe(404);
  });

  test("a fix the Studio cannot make is a 400 that says what to run", async () => {
    const res = await post(makeRoute({}), "/validate/fix", {
      moduleFilePath: PAGE,
      sourcePath: `${PAGE}?p="hero"`,
      fix: "image:upload-remote",
    });
    expect(res.status).toBe(400);
    expect(bodyOf(res)).toEqual({
      message: expect.stringContaining("val validate --fix"),
    });
  });

  test("an unknown fix code is refused before anything runs", async () => {
    const res = await post(makeRoute({}), "/validate/fix", {
      moduleFilePath: PAGE,
      sourcePath: `${PAGE}?p="hero"`,
      fix: "image:make-it-pretty",
    });
    expect(res.status).toBe(400);
  });

  describe("in http mode", () => {
    /*
     * The only mode where auth can be tested: `getAuth` lets everyone in in fs
     * mode, by design. `apiKey` + `valSecret` is what makes it http mode; no
     * request reaches the content service, because auth is refused first.
     */
    const previousEnv = {
      commit: process.env["VAL_GIT_COMMIT"],
      branch: process.env["VAL_GIT_BRANCH"],
    };
    beforeAll(() => {
      process.env["VAL_GIT_COMMIT"] =
        "0000000000000000000000000000000000000000";
      process.env["VAL_GIT_BRANCH"] = "main";
    });
    afterAll(() => {
      if (previousEnv.commit === undefined)
        delete process.env["VAL_GIT_COMMIT"];
      else process.env["VAL_GIT_COMMIT"] = previousEnv.commit;
      if (previousEnv.branch === undefined)
        delete process.env["VAL_GIT_BRANCH"];
      else process.env["VAL_GIT_BRANCH"] = previousEnv.branch;
    });
    const httpRoute = () =>
      makeRoute({
        apiKey: "test-api-key",
        valSecret: "test-secret",
        project: "test-org/test-project",
        valContentUrl: "http://localhost:9999",
        versions: { core: "0.0.0-test", next: "0.0.0-test" },
      });

    test.each(["/validate", "/validate/fix"])(
      "%s refuses a caller with no session",
      async (subPath) => {
        const res = await post(
          httpRoute(),
          subPath,
          {
            moduleFilePath: PAGE,
            sourcePath: `${PAGE}?p="hero"`,
            fix: "image:add-metadata",
          },
          new Headers(),
        );
        expect(res.status).toBe(401);
      },
    );
  });
});
