/** @jest-environment jsdom */
import { renderHook } from "@testing-library/react";
import { initVal, ModuleFilePath, SerializedSchema } from "@valbuild/core";
import { Remote } from "../../utils/Remote";

/**
 * What the nav menu lists, and what `hidden` keeps out of it.
 *
 * `hidden` on a MODULE's root schema means "the nav does not list this" — a
 * module has no parent to be hidden from, so it can mean nothing else. This
 * pins that the rule reaches every destination the menu has, not only the
 * Explorer: a hidden page router contributes no rows to Pages, and a hidden
 * settings module is not offered as Settings.
 *
 * `useTrees` is NOT mocked here — the point is the whole chain from schemas to
 * menu, since the sitemap is built two hops away from where the flag is read.
 */
let mockSchemas: Remote<Record<ModuleFilePath, SerializedSchema>> = {
  status: "loading",
};

jest.mock("../ValFieldProvider", () => ({
  __esModule: true,
  useSchemas: () => mockSchemas,
}));
jest.mock("../ValProvider", () => ({
  __esModule: true,
  // What the real hook derives for the `/app/…/page.val.ts` modules below.
  usePageRouterSrcFolder: () => ({ status: "success", data: "/app" }),
  // One entry per sitemap module, keyed by URL path. The real hook reads the
  // store; the shape is all this needs. `/app/blogs/page.val.ts` → `/blogs`,
  // which is what that module's router key would be.
  useShallowModulesAtPaths: (paths: ModuleFilePath[]) => ({
    status: "success",
    data: paths.map((moduleFilePath) => {
      const urlPath = moduleFilePath
        .replace(/^\/app/, "")
        .replace(/\/page\.val\.ts$/, "");
      return { [urlPath]: `${moduleFilePath}?p="${urlPath}"` };
    }),
  }),
}));
jest.mock("../ValErrorProvider", () => ({
  __esModule: true,
  useAllValidationErrors: () => ({}),
}));

import { useNavMenuData } from "./useNavMenuData";

const { s } = initVal();

function mount(schemas: Record<string, SerializedSchema>) {
  mockSchemas = {
    status: "success",
    data: schemas as Record<ModuleFilePath, SerializedSchema>,
  };
  return renderHook(() => useNavMenuData()).result.current;
}

const settings = s.settings()["executeSerialize"]();
const photos = s
  .imageset({ accept: "image/*", dir: "/public/val/photos" })
  ["executeSerialize"]();
const docs = s
  .fileset({ accept: "*/*", dir: "/public/val/docs" })
  ["executeSerialize"]();

/**
 * A page router, in the wire form the Studio is handed.
 *
 * Written out rather than built with `.router(nextAppRouter)`: the router
 * exports are not reachable from this package's jest resolution, and the wire
 * form is what `useTrees` reads anyway.
 */
function router(): SerializedSchema {
  return {
    ...s.record(s.object({ title: s.string() }))["executeSerialize"](),
    router: "next-app-router",
  };
}

function hide(schema: SerializedSchema): SerializedSchema {
  return { ...schema, hidden: true };
}

describe("useNavMenuData", () => {
  test("a page router puts its pages in the sitemap", () => {
    const menu = mount({
      "/app/blogs/page.val.ts": router(),
    });
    expect(menu.status).toBe("success");
    if (menu.status !== "success") return;
    expect(menu.data.hasRouters).toBe(true);
    expect(menu.data.sitemap).toBeDefined();
  });

  /**
   * The half of this rule worth a test of its own: a page router is usually the
   * last thing a project wants out of its sitemap, so if `hidden` ever stops
   * reaching routers it should stop here rather than in someone's nav.
   */
  test("a hidden page router contributes nothing to Pages", () => {
    const menu = mount({
      "/app/blogs/page.val.ts": hide(router()),
    });
    expect(menu.status).toBe("success");
    if (menu.status !== "success") return;
    expect(menu.data.hasRouters).toBe(false);
    expect(menu.data.sitemap).toBeUndefined();
    // And it does not fall through into the Explorer instead.
    expect(menu.data.explorer).toBeUndefined();
  });

  test("one of two routers hidden leaves the other listed", () => {
    const menu = mount({
      "/app/blogs/page.val.ts": router(),
      "/app/internal/page.val.ts": hide(router()),
    });
    expect(menu.status).toBe("success");
    if (menu.status !== "success") return;
    expect(menu.data.hasRouters).toBe(true);
    const names = menu.data.sitemap?.children.map((child) => child.name);
    expect(names).toEqual(["blogs"]);
  });

  test("the settings module is a destination, unless it is hidden", () => {
    const shown = mount({
      "/val.settings.val.ts": settings,
    });
    expect(shown.status).toBe("success");
    if (shown.status !== "success") return;
    expect(shown.data.settings).toEqual({
      moduleFilePath: "/val.settings.val.ts",
    });

    const hidden = mount({
      "/val.settings.val.ts": hide(settings),
    });
    expect(hidden.status).toBe("success");
    if (hidden.status !== "success") return;
    expect(hidden.data.settings).toBeUndefined();
  });

  test("a hidden gallery is not a Media destination", () => {
    const menu = mount({
      "/content/photos.val.ts": hide(photos),
      "/content/docs.val.ts": docs,
    });
    expect(menu.status).toBe("success");
    if (menu.status !== "success") return;
    expect(menu.data.media?.map((m) => m.moduleFilePath)).toEqual([
      "/content/docs.val.ts",
    ]);
  });
});
