import fs from "fs";
import os from "os";
import path from "path";
import { Internal, initVal, modules } from "@valbuild/core";
import { createValApiRouter, createValServer } from "./ValRouter";
import { encodeJwt } from "./jwt";
import { fakeRequest } from "./fakeRequest";

/**
 * Saving an edit in fs mode, to a module whose objects spread a shared
 * constant into themselves. The shape is valbuild/web's home page: a router,
 * and cards written `{ title, ...noMedia, learnMore }`.
 *
 * It went wrong twice over. The TypeScript patcher refused any object with a
 * spread on the edited path ("Object literal element must be property
 * assignment"), so `/save` threw the editor's change away as one that "could
 * not be applied" - and the refusal carried the TypeScript node it was about,
 * which `JSON.stringify` could crash on ("Converting circular structure to
 * JSON").
 */
describe("/save, to a .val.ts whose objects use spreads", () => {
  const route = "/api/val";
  const { c, s, config } = initVal({});
  const PAGE = "/app/home/page.val.ts";
  const SOURCE = `import { c, s, nextAppRouter } from "../../val.config";

const noMedia = { video: null, poster: null };

export default c.define(
  "${PAGE}",
  s.router(
    nextAppRouter,
    s.object({
      cards: s.array(
        s.object({
          title: s.string(),
          video: s.string().nullable(),
          poster: s.string().nullable(),
          learnMore: s.string().nullable(),
        }),
      ),
    }),
  ),
  {
    "/home": {
      cards: [
        { title: "First", ...noMedia, learnMore: null },
        { title: "Second", learnMore: "/docs", ...noMedia },
      ],
    },
  },
);
`;
  const schema = s.router(
    Internal.nextAppRouter,
    s.object({
      cards: s.array(
        s.object({
          title: s.string(),
          video: s.string().nullable(),
          poster: s.string().nullable(),
          learnMore: s.string().nullable(),
        }),
      ),
    }),
  );
  const noMedia = { video: null, poster: null };
  let root: string;
  let cwd: jest.SpyInstance;

  const makeRoute = () =>
    createValApiRouter(
      route,
      createValServer(
        modules(config, [
          {
            def: () =>
              Promise.resolve({
                default: c.define(PAGE, schema, {
                  "/home": {
                    cards: [
                      { title: "First", ...noMedia, learnMore: null },
                      { title: "Second", learnMore: "/docs", ...noMedia },
                    ],
                  },
                }),
              }),
          },
        ]),
        route,
        { disableCache: true },
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

  const call = (
    onRoute: ReturnType<typeof makeRoute>,
    method: "POST" | "PUT",
    subPath: string,
    json: unknown,
  ) =>
    onRoute(
      fakeRequest({
        method,
        url: new URL(`http://localhost:3000${route}${subPath}`),
        json,
        headers: new Headers({ Cookie: `val_session=${encodeJwt({}, "")}` }),
      }),
    );
  const bodyOf = (res: Awaited<ReturnType<typeof call>>): unknown =>
    "json" in res ? res.json : undefined;

  /** Makes the edit as the Studio does, then saves it. */
  const editAndSave = async (path: string[], value: string) => {
    const onRoute = makeRoute();
    const stat = bodyOf(
      await call(onRoute, "POST", "/stat", {
        sourcesSha: "s",
        schemaSha: "s",
        baseSha: "b",
      }),
    );
    if (
      typeof stat !== "object" ||
      stat === null ||
      !("baseSha" in stat) ||
      typeof stat.baseSha !== "string"
    ) {
      throw new Error(`No baseSha in /stat: ${JSON.stringify(stat)}`);
    }
    const patchId = "0bea143d-0bb2-4f4d-b281-e12ddd671e6f";
    const put = await call(onRoute, "PUT", "/patches", {
      parentRef: { type: "head", headBaseSha: stat.baseSha },
      patches: [
        { path: PAGE, patchId, patch: [{ op: "replace", path, value }] },
      ],
    });
    expect(put.status).toBe(200);
    const save = await call(onRoute, "POST", "/save", { patchIds: [patchId] });
    return { save, body: bodyOf(save) };
  };

  const written = () => fs.readFileSync(path.join(root, PAGE), "utf8");

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "val-save-spread-"));
    // fs mode serves the project in the working directory.
    cwd = jest.spyOn(process, "cwd").mockReturnValue(root);
    fs.mkdirSync(path.join(root, path.dirname(PAGE)), { recursive: true });
    fs.writeFileSync(path.join(root, PAGE), SOURCE);
  });

  afterEach(() => {
    cwd.mockRestore();
    fs.rmSync(root, { recursive: true, force: true });
  });

  test("an edit to a key written after the spread is saved, spread and all", async () => {
    const { save, body } = await editAndSave(
      ["/home", "cards", "0", "learnMore"],
      "/blogs/Test",
    );

    expect({ status: save.status, body }).toEqual({
      status: 200,
      body: expect.not.objectContaining({ removed: expect.anything() }),
    });
    expect(written()).toContain(
      `{ title: "First", ...noMedia, learnMore: "/blogs/Test" }`,
    );
  });

  test("an edit a spread could undo is refused with a sentence that names it", async () => {
    const { save, body } = await editAndSave(
      ["/home", "cards", "1", "learnMore"],
      "/blogs/Test",
    );

    expect(save.status).not.toBe(500);
    expect(JSON.stringify(body)).toContain(
      `Cannot edit \\"learnMore\\": \\"...noMedia\\" comes after it`,
    );
    expect(written()).toBe(SOURCE);
  });
});
