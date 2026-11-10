/** @jest-environment jsdom */
import { initVal } from "@valbuild/core";
import { act, fireEvent, render } from "@testing-library/react";
import { splitBlock } from "prosemirror-commands";
import { EditorState, TextSelection, type Command } from "prosemirror-state";
import { SketchpadEditor, setTextType } from "./SketchpadEditor";
import { docFromSketch, sketchFromDoc, sketchSchema } from "./sketchpadDoc";
import { highlights, highlightsKey } from "./highlights";
import {
  fieldLinks,
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

describe("a link, as the person edits around it", () => {
  const state = (text: string) =>
    EditorState.create({
      doc: docFromSketch(text).doc,
      plugins: [fieldLinks(() => undefined), highlights()],
    });
  const run = (s: EditorState, command: Command) => {
    let next = s;
    command(s, (tr) => {
      next = s.applyTransaction(tr).state;
    });
    return next;
  };
  const textOf = (s: EditorState) => sketchFromDoc(s.doc, {});
  const lead = '/content/home.val.ts?p="hero"."lead"';

  test("Enter at the start of a linked paragraph leaves the link on its text", () => {
    let s = state(`Hello world {field: ${lead}}\n`);
    s = s.apply(s.tr.setSelection(TextSelection.create(s.doc, 1)));
    s = run(s, splitBlock);
    // The empty line above is not linked: typing there writes nothing.
    s = s.apply(s.tr.insertText("Intro", 1));
    expect(textOf(s)).toBe(`Intro\nHello world {field: ${lead}}\n`);
    expect(
      linkedFieldChanges(`Hello world {field: ${lead}}\n`, textOf(s)),
    ).toEqual([]);
  });

  test("a change of block type keeps each block's own link", () => {
    let s = state(`One {field: ${title}}\nTwo {field: ${lead}}\n`);
    s = s.apply(
      s.tr.setSelection(TextSelection.create(s.doc, 1, s.doc.content.size - 1)),
    );
    s = run(s, setTextType(sketchSchema.nodes.heading, { level: 2 }));
    expect(textOf(s)).toBe(
      `## One {field: ${title}}\n## Two {field: ${lead}}\n`,
    );
  });

  test("a field of several lines is not linked", () => {
    const multiline = {
      "/content/home.val.ts": s
        .object({ hero: s.object({ title: s.string().multiline() }) })
        ["executeSerialize"](),
    };
    expect(fieldLinkInfo(title, multiline, sources).status).toBe("multiline");
  });
});

describe("a highlight", () => {
  test("stays on its block when a line is added above it", () => {
    let st = EditorState.create({
      doc: docFromSketch("# A\nB\nC\n").doc,
      plugins: [highlights()],
    });
    st = st.apply(
      st.tr.setMeta(highlightsKey, [
        { id: "h", lines: [3], color: "red", note: "this one" },
      ]),
    );
    st = st.apply(
      st.tr.insert(
        0,
        sketchSchema.nodes.paragraph.create(null, sketchSchema.text("New")),
      ),
    );
    const pos = highlightsKey.getState(st)?.positions.get("h")?.[0];
    expect(pos === undefined ? null : st.doc.nodeAt(pos)?.textContent).toBe(
      "C",
    );
  });
});
