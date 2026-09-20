/** @jest-environment jsdom */
import { render, screen } from "@testing-library/react";
import { PathHeading } from "./PathHeading";
import { Description } from "../utils/describePath";

jest.mock("./ValFieldProvider", () => ({
  __esModule: true,
  useFilePatchIds: () => new Map<string, string>(),
}));

function described(over: Partial<Description>): Description {
  return {
    title: "Authors",
    pathLabel: "Authors",
    subtitle: null,
    image: null,
    url: null,
    origin: { title: "fallback", subtitle: "fallback", image: "fallback" },
    ...over,
  };
}

const scope = <span>Content</span>;

/**
 * The heading's scope line is WHERE YOU ARE, and a title never goes in it.
 *
 * A `.preview(...)` is what a thing is CALLED — the heading, a card, a list row.
 * The line under the heading locates it, and the only thing a location can be
 * made of is path segments. The one thing the heading contributes there is a
 * page's ROUTE, because a route IS the page's location.
 */
describe("the heading's scope line", () => {
  test("a path inside a module never adds a module segment", () => {
    render(
      <PathHeading
        description={described({
          title: "Teddy",
          pathLabel: "teddy",
          origin: {
            title: "preview",
            subtitle: "fallback",
            image: "fallback",
          },
        })}
        scope={scope}
      />,
    );
    expect(screen.getByText("Teddy")).not.toBeNull();
    expect(screen.queryByText("teddy")).toBeNull();
  });

  test("a renamed page finishes the trail with its route", () => {
    render(
      <PathHeading
        description={described({
          title: "Launching Val",
          pathLabel: "/blogs/launch",
          url: "/blogs/launch",
          origin: {
            title: "preview",
            subtitle: "fallback",
            image: "fallback",
          },
        })}
        scope={scope}
      />,
    );
    expect(screen.getByText("blogs")).not.toBeNull();
    expect(screen.getByText("launch")).not.toBeNull();
  });
});
