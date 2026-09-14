/** @jest-environment jsdom */
import { fireEvent, render, screen } from "@testing-library/react";
import { ModuleFilePath } from "@valbuild/core";
import { PagesPanel, routeOfPage } from "./PagesPanel";
import { AvailableRoute } from "../NavMenu/NewPageForm";
import { ShellNewPageRoutes, ShellPage } from "./types";

/**
 * Duplicating and renaming a page from the site map.
 *
 * The panel is presentational: it picks the URL and hands back the two paths,
 * and the app writes (see `useDuplicateRecordEntry` and `useRenamePage`). What
 * is checkable here is the part that decides whether the controls can be
 * offered at all, and that the forms they open are the source page's own route.
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
      onRenamePage={() => undefined}
      newPage={newPage}
      onClose={() => undefined}
      {...props}
    />
  );
}

/** Open a row's actions menu, then the item named. */
function openRowForm(urlPath: string, item: "Duplicate" | "Rename") {
  fireEvent.click(
    screen.getByRole("button", { name: `Page actions ${urlPath}` }),
  );
  fireEvent.click(screen.getByRole("menuitem", { name: item }));
}

describe("The Pages panel's row actions", () => {
  test("are offered on a page under a known route", () => {
    render(panel());
    fireEvent.click(
      screen.getByRole("button", { name: "Page actions /blogs/why-val" }),
    );
    expect(
      screen.queryByRole("menuitem", { name: "Duplicate" }),
    ).not.toBeNull();
    expect(screen.queryByRole("menuitem", { name: "Rename" })).not.toBeNull();
  });

  test("are not offered when the mode cannot write", () => {
    render(panel({ onDuplicatePage: undefined, onRenamePage: undefined }));
    expect(screen.queryByRole("button", { name: /^Page actions/ })).toBeNull();
  });

  // One write can be offered without the other: the menu carries what the mode
  // can actually do rather than an item that would do nothing.
  test("offer only the write the app handed in", () => {
    render(panel({ onRenamePage: undefined }));
    fireEvent.click(
      screen.getByRole("button", { name: "Page actions /blogs/why-val" }),
    );
    expect(
      screen.queryByRole("menuitem", { name: "Duplicate" }),
    ).not.toBeNull();
    expect(screen.queryByRole("menuitem", { name: "Rename" })).toBeNull();
  });

  // Without the route patterns there is no URL to offer for either.
  test("are not offered when no route accepts a page", () => {
    render(panel({ newPage: undefined }));
    expect(screen.queryByRole("button", { name: /^Page actions/ })).toBeNull();
  });

  test("are not offered on a row that is only a path segment", () => {
    render(panel({ pages: [blogsFolder] }));
    expect(
      screen.queryByRole("button", { name: "Page actions /blogs" }),
    ).toBeNull();
  });
});

describe("Duplicate in the Pages panel", () => {
  test("opens a form on the source page's route, prefilled with its URL", () => {
    render(panel());
    openRowForm("/blogs/why-val", "Duplicate");
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
    openRowForm("/blogs/why-val", "Duplicate");
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
    openRowForm("/blogs/why-val", "Duplicate");
    expect(
      screen
        .getByRole("button", { name: "Duplicate" })
        .getAttribute("disabled"),
    ).not.toBeNull();
  });

  test("refuses a URL another page already has", () => {
    render(panel());
    openRowForm("/blogs/why-val", "Duplicate");
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
 * Renaming asks the same question a duplicate does - which URL - so it opens
 * the same form. What differs is which callback it lands in: one leaves the
 * original page where it is and the other does not.
 */
describe("Rename in the Pages panel", () => {
  test("opens a form on the page's own route, prefilled with its URL", () => {
    render(panel());
    openRowForm("/blogs/why-val", "Rename");
    expect(screen.queryByText("Rename page")).not.toBeNull();
    expect(screen.getByDisplayValue("why-val")).not.toBeNull();
  });

  test("hands back the old URL and the new one", () => {
    const calls: [string, string, string][] = [];
    render(
      panel({
        onRenamePage: (moduleFilePath, from, to) =>
          calls.push([moduleFilePath, from, to]),
      }),
    );
    openRowForm("/blogs/why-val", "Rename");
    fireEvent.change(screen.getByDisplayValue("why-val"), {
      target: { value: "why-val-2" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Rename" }));
    expect(calls).toEqual([
      [blogRoute.moduleFilePath, "/blogs/why-val", "/blogs/why-val-2"],
    ]);
  });

  // A rename that does not move the page is not a rename, and one onto another
  // page's URL would be two pages at one URL.
  test("refuses the URL the page already has, and one another page has", () => {
    render(panel());
    openRowForm("/blogs/why-val", "Rename");
    expect(
      screen.getByRole("button", { name: "Rename" }).getAttribute("disabled"),
    ).not.toBeNull();
    fireEvent.change(screen.getByDisplayValue("why-val"), {
      target: { value: "hello" },
    });
    expect(
      screen.getByRole("button", { name: "Rename" }).getAttribute("disabled"),
    ).not.toBeNull();
  });

  // Renaming does not copy, so the panel must not land the URL in the other
  // callback: the two forms look alike and the menu is what tells them apart.
  test("does not go through the duplicate callback", () => {
    const duplicated: string[] = [];
    render(panel({ onDuplicatePage: (_m, _f, to) => duplicated.push(to) }));
    openRowForm("/blogs/why-val", "Rename");
    fireEvent.change(screen.getByDisplayValue("why-val"), {
      target: { value: "why-val-2" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Rename" }));
    expect(duplicated).toEqual([]);
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
