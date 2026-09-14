/** @jest-environment jsdom */
import { render, screen } from "@testing-library/react";
import { ModuleFilePath } from "@valbuild/core";
import { PathHeading } from "./PathHeading";
import { Description } from "../utils/describePath";

jest.mock("./ValFieldProvider", () => ({
  __esModule: true,
  useFilePatchIds: () => new Map<string, string>(),
}));

const AUTHORS = "/content/authors.val.ts" as ModuleFilePath;

function described(over: Partial<Description>): Description {
  return {
    title: "Authors",
    pathLabel: "Authors",
    subtitle: null,
    image: null,
    url: null,
    moduleFilePath: AUTHORS,
    isModuleRoot: true,
    origin: { title: "fallback", subtitle: "fallback", image: "fallback" },
    ...over,
  };
}

const scope = <span>Content</span>;

/**
 * A name that replaces an identity has to leave the identity visible — a page
 * is identified by its route, a module by its file. Both join the scope line,
 * and neither is repeated when nothing replaced it.
 */
describe("the heading's scope line", () => {
  test("a renamed module finishes the trail with its own name", () => {
    render(
      <PathHeading
        description={described({
          title: "Foo fighters",
          origin: {
            title: "preview",
            subtitle: "fallback",
            image: "fallback",
          },
        })}
        scope={scope}
      />,
    );
    // "Content / Authors" — the segment the folder was leading to, not the
    // whole module file path, which would repeat "Content" and switch the
    // line's register halfway along.
    expect(screen.getByText("Content")).not.toBeNull();
    const own = screen.getByText("Authors");
    expect(own).not.toBeNull();
    // The full path is still one hover away.
    expect(own.getAttribute("title")).toBe(AUTHORS);
    expect(screen.queryByText(AUTHORS)).toBeNull();
  });

  test("a module nobody renamed does not say its name twice", () => {
    render(<PathHeading description={described({})} scope={scope} />);
    // The heading IS "Authors"; the trail is just the folder.
    expect(screen.getByText("Content")).not.toBeNull();
    expect(screen.getAllByText("Authors")).toHaveLength(1);
  });

  test("a path inside a module never adds a module segment", () => {
    render(
      <PathHeading
        description={described({
          title: "Teddy",
          pathLabel: "teddy",
          isModuleRoot: false,
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
          isModuleRoot: false,
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
