/** @jest-environment jsdom */
import { initVal } from "@valbuild/core";
import { act, fireEvent, render } from "@testing-library/react";
import { SketchpadEditor } from "./SketchpadEditor";
import {
  fieldLabel,
  fieldLinkInfo,
  linkedFieldChanges,
  splitField,
  type FieldLinkInfo,
} from "./fieldLinks";

const { s } = initVal();

const title = '/content/home.val.ts?p="hero"."title"';
const body = '/content/home.val.ts?p="hero"."body"';
const schemas = {
  "/content/home.val.ts": s
    .object({
      hero: s.object({ title: s.string(), body: s.richtext() }),
    })
    ["executeSerialize"](),
};
const sources = {
  "/content/home.val.ts": {
    hero: { title: "Welcome", body: [] },
  },
};

describe("a link to a field", () => {
  test("is named by the field and the one above it", () => {
    expect(fieldLabel(title)).toBe("hero › title");
  });

  test("writes where the field is", () => {
    expect(splitField(title)).toEqual({
      moduleFilePath: "/content/home.val.ts",
      path: ["hero", "title"],
    });
  });

  test("is to a text field, one that is there", () => {
    expect(fieldLinkInfo(title, schemas, sources)).toEqual({
      status: "ok",
      label: "hero › title",
      value: "Welcome",
    });
    expect(fieldLinkInfo(body, schemas, sources).status).toBe("not-text");
    expect(
      fieldLinkInfo('/content/home.val.ts?p="nope"', schemas, sources).status,
    ).toBe("missing");
  });

  test("writes only what typing changed", () => {
    const before = `# Welcome {field: ${title}}\n`;
    expect(
      linkedFieldChanges(before, `# Welcome all {field: ${title}}\n`),
    ).toEqual([{ field: title, text: "Welcome all" }]);
    // A new link, or one broken, is not a change to the content.
    expect(linkedFieldChanges("# Welcome\n", before)).toEqual([]);
    expect(linkedFieldChanges(before, "# Welcome all\n")).toEqual([]);
  });
});

describe("a linked block in the editor", () => {
  const ok =
    (value: string): ((field: string) => FieldLinkInfo) =>
    () => ({ status: "ok", label: "hero › title", value });

  test("says what it is linked to, and can be unlinked", () => {
    const onChange = jest.fn();
    const { container, getByText } = render(
      <SketchpadEditor
        value={`# Welcome {field: ${title}}\n`}
        attach={null}
        onChange={onChange}
        fieldInfo={ok("Welcome")}
      />,
    );
    expect(container.querySelector("[data-field-chip]")?.textContent).toContain(
      "hero › title",
    );
    act(() => {
      fireEvent.click(getByText("Unlink"));
    });
    expect(onChange).toHaveBeenLastCalledWith("# Welcome\n");
    expect(container.querySelector("[data-field-chip]")).toBeNull();
  });

  test("says when the field changed elsewhere, and takes its text", () => {
    const onChange = jest.fn();
    const { getByText } = render(
      <SketchpadEditor
        value={`# Welcome {field: ${title}}\n`}
        attach={null}
        onChange={onChange}
        fieldInfo={ok("Hello there")}
      />,
    );
    expect(getByText("hero › title: changed elsewhere")).toBeTruthy();
    act(() => {
      fireEvent.click(getByText("Use the content's"));
    });
    expect(onChange).toHaveBeenLastCalledWith(
      `# Hello there {field: ${title}}\n`,
    );
  });
});
