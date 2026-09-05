/** @jest-environment jsdom */
import { fireEvent, render, screen } from "@testing-library/react";
import { ModuleFilePath } from "@valbuild/core";
import { PagesPanel, routeOfPage } from "./PagesPanel";
import { AvailableRoute } from "../NavMenu/NewPageForm";
import { ShellNewPageRoutes, ShellPage } from "./types";

/**
 * Duplicating a page from the site map.
 *
 * The panel is presentational: it picks the copy's URL and hands back the two
 * paths, and the app copies the entry (see `useDuplicateRecordEntry`). What is
 * checkable here is the part that decides whether the control can be offered
 * at all, and that the form it opens is the source page's own route.
 */
const blogRoute: AvailableRoute = {
  moduleFilePath: "/app/blogs/[blog]/page.val.ts" as ModuleFilePath,
  routePattern: [
    { type: "literal", name: "blogs" },
    { type: "string-param", paramName: "blog", optional: false },
  ],
  patternString: "/blogs/[blog]",
  existingKeys: ["/blogs/why-val", "/blogs/hello"],
};
const shopRoute: AvailableRoute = {
  moduleFilePath:
    "/app/shop/[category]/[product]/page.val.ts" as ModuleFilePath,
  routePattern: [
    { type: "literal", name: "shop" },
    { type: "string-param", paramName: "category", optional: false },
    { type: "string-param", paramName: "product", optional: false },
  ],
  patternString: "/shop/[category]/[product]",
  existingKeys: [],
};

const whyVal: ShellPage = {
  id: "why-val",
  name: "why-val",
  urlPath: "/blogs/why-val",
  sourcePath: '/app/blogs/[blog]/page.val.ts?p="%2Fblogs%2Fwhy-val"',
  isTracked: true,
};
/** A row that exists only because a page below it does. */
const blogsFolder: ShellPage = {
  id: "blogs",
  name: "blogs",
  urlPath: "/blogs",
  children: [whyVal],
};

const newPage: ShellNewPageRoutes = { routes: [blogRoute, shopRoute] };

function panel(props: Partial<Parameters<typeof PagesPanel>[0]> = {}) {
  return (
    <PagesPanel
      breakpoint="desktop"
      pages={[whyVal]}
      externalPages={[]}
      selectedId={null}
      onSelectPage={() => undefined}
      onSelectExternalPage={() => undefined}
      onNewPage={() => undefined}
      onDuplicatePage={() => undefined}
      newPage={newPage}
      onClose={() => undefined}
      {...props}
    />
  );
}

describe("Duplicate in the Pages panel", () => {
  test("is offered on a page under a known route", () => {
    render(panel());
    expect(
      screen.queryByRole("button", { name: "Duplicate /blogs/why-val" }),
    ).not.toBeNull();
  });

  test("is not offered when the mode cannot write", () => {
    render(panel({ onDuplicatePage: undefined }));
    expect(screen.queryByRole("button", { name: /^Duplicate/ })).toBeNull();
  });

  // Without the route patterns there is no URL to offer for the copy.
  test("is not offered when no route accepts a page", () => {
    render(panel({ newPage: undefined }));
    expect(screen.queryByRole("button", { name: /^Duplicate/ })).toBeNull();
  });

  test("is not offered on a row that is only a path segment", () => {
    render(panel({ pages: [blogsFolder] }));
    expect(
      screen.queryByRole("button", { name: "Duplicate /blogs" }),
    ).toBeNull();
  });

  test("opens a form on the source page's route, prefilled with its URL", () => {
    render(panel());
    fireEvent.click(
      screen.getByRole("button", { name: "Duplicate /blogs/why-val" }),
    );
    expect(screen.queryByText("Duplicate page")).not.toBeNull();
    // The dynamic segment of `/blogs/[blog]`, filled in from the source page.
    expect(screen.getByDisplayValue("why-val")).not.toBeNull();
  });

  test("hands back the source URL and the one that was typed", () => {
    const calls: [string, string, string][] = [];
    render(
      panel({
        onDuplicatePage: (moduleFilePath, from, to) =>
          calls.push([moduleFilePath, from, to]),
      }),
    );
    fireEvent.click(
      screen.getByRole("button", { name: "Duplicate /blogs/why-val" }),
    );
    fireEvent.change(screen.getByDisplayValue("why-val"), {
      target: { value: "why-val-copy" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Duplicate" }));
    expect(calls).toEqual([
      [blogRoute.moduleFilePath, "/blogs/why-val", "/blogs/why-val-copy"],
    ]);
  });

  // The copy has to go somewhere new, or it is not a copy.
  test("refuses the URL the page already has", () => {
    render(panel());
    fireEvent.click(
      screen.getByRole("button", { name: "Duplicate /blogs/why-val" }),
    );
    expect(
      screen
        .getByRole("button", { name: "Duplicate" })
        .getAttribute("disabled"),
    ).not.toBeNull();
  });

  test("refuses a URL another page already has", () => {
    render(panel());
    fireEvent.click(
      screen.getByRole("button", { name: "Duplicate /blogs/why-val" }),
    );
    fireEvent.change(screen.getByDisplayValue("why-val"), {
      target: { value: "hello" },
    });
    expect(
      screen
        .getByRole("button", { name: "Duplicate" })
        .getAttribute("disabled"),
    ).not.toBeNull();
  });
});

/**
 * `routeOfPage` needs BOTH halves to agree — the module and a pattern the URL
 * fits — because either alone can name the wrong route.
 */
describe("routeOfPage", () => {
  test("finds the route a page was created under", () => {
    expect(routeOfPage([blogRoute, shopRoute], whyVal)).toBe(blogRoute);
  });

  test("is null for a row with no content of its own", () => {
    expect(routeOfPage([blogRoute], blogsFolder)).toBeNull();
  });

  test("is null when the URL does not fit the module's pattern", () => {
    expect(
      routeOfPage([blogRoute], {
        ...whyVal,
        urlPath: "/blogs/why-val/extra",
      }),
    ).toBeNull();
  });

  test("is null when the pattern fits but the module is another router's", () => {
    expect(
      routeOfPage(
        [
          {
            ...blogRoute,
            moduleFilePath: "/app/news/[item]/page.val.ts" as ModuleFilePath,
          },
        ],
        whyVal,
      ),
    ).toBeNull();
  });
});
