import {
  GuideRequest,
  createGuideCall,
  ShowGuideArgs,
  guideResult,
  guideTargetsOnScreen,
  guideTourSteps,
} from "./assistantGuide";

/**
 * The assistant's guide, as tour steps.
 *
 * What a model writes is checked here before anything is drawn: a step that
 * points at nothing, or waits for something that can never happen, is a
 * guide the person cannot get through, and the model is the one who can fix
 * it -- so every refusal says what was wrong, in terms it wrote.
 */
function parse(args: unknown): ShowGuideArgs {
  return ShowGuideArgs.parse(args);
}

const PAGE = '/app/blog/[slug]/page.val.ts?p="/blog/my-post"';

describe("guideTourSteps", () => {
  test("a control, a row, a field and a place on the page", () => {
    const result = guideTourSteps(
      parse({
        title: "Add a blog post",
        steps: [
          { point_at: { control: "pages" }, title: "Open Pages", text: "a" },
          { point_at: { page_row: "/blog" }, title: "Open blog", text: "b" },
          {
            point_at: { module_row: "/content/footer.val.ts" },
            title: "Open the footer",
            text: "c",
          },
          { point_at: { field: PAGE }, title: "The post", text: "d" },
          { point_at: { on_page: PAGE }, title: "On the page", text: "e" },
          { title: "That's all", text: "f" },
        ],
      }),
    );
    if ("error" in result) throw new Error(result.error);
    expect(
      result.steps.map(({ target, field, page }) => ({ target, field, page })),
    ).toEqual([
      { target: "pages", field: undefined, page: undefined },
      { target: "page:/blog", field: undefined, page: undefined },
      {
        target: "module:/content/footer.val.ts",
        field: undefined,
        page: undefined,
      },
      { target: undefined, field: PAGE, page: undefined },
      { target: "canvas", field: undefined, page: PAGE },
      { target: undefined, field: undefined, page: undefined },
    ]);
    // Unique ids: the tour's card names its step by them.
    expect(new Set(result.steps.map((step) => step.id)).size).toBe(6);
  });

  test("what moves each step on", () => {
    const result = guideTourSteps(
      parse({
        title: "Everything",
        steps: [
          { title: "a", text: "a", done_when: { panel_open: "pages" } },
          { title: "b", text: "b", done_when: { opened: PAGE } },
          { title: "c", text: "c", done_when: { changed: true } },
          { title: "d", text: "d", done_when: { page_added: PAGE } },
          { title: "e", text: "e", done_when: { language_changed: true } },
          { title: "f", text: "f" },
        ],
      }),
    );
    if ("error" in result) throw new Error(result.error);
    expect(result.steps.map((step) => step.moveOn)).toEqual([
      { type: "panel", panel: "pages" },
      { type: "open", path: PAGE },
      // Nothing to write: Do it for me is not offered for a change.
      { type: "edit" },
      { type: "newPage", path: PAGE },
      { type: "locale" },
      undefined,
    ]);
  });

  test("a field that is not a source path is refused, naming the step", () => {
    const result = guideTourSteps(
      parse({
        title: "x",
        steps: [
          { title: "ok", text: "ok" },
          { point_at: { field: "title" }, title: "bad", text: "bad" },
        ],
      }),
    );
    expect(result).toEqual({
      error: "steps[1].point_at.field is not a source path.",
    });
  });

  test("so is one the core parser refuses: an unclosed quote", () => {
    const result = guideTourSteps(
      parse({
        title: "x",
        steps: [
          {
            point_at: { field: '/content/footer.val.ts?p="title' },
            title: "bad",
            text: "bad",
          },
        ],
      }),
    );
    expect(result).toEqual({
      error: "steps[0].point_at.field is not a source path.",
    });
  });

  test("so is a step that waits for a path that is not one", () => {
    const result = guideTourSteps(
      parse({
        title: "x",
        steps: [{ title: "bad", text: "bad", done_when: { opened: "blog" } }],
      }),
    );
    expect(result).toEqual({
      error: "steps[0].done_when: opened is not a source path.",
    });
  });
});

describe("ShowGuideArgs", () => {
  test("a control the Studio does not have is refused", () => {
    expect(
      ShowGuideArgs.safeParse({
        title: "x",
        steps: [{ point_at: { control: "delete" }, title: "a", text: "a" }],
      }).success,
    ).toBe(false);
  });

  test("a row with a space or a quote is refused: it is a selector token", () => {
    for (const page_row of ["/my page", '/a"b']) {
      expect(
        ShowGuideArgs.safeParse({
          title: "x",
          steps: [{ point_at: { page_row }, title: "a", text: "a" }],
        }).success,
      ).toBe(false);
    }
  });

  test("two things to point at in one step is refused", () => {
    expect(
      ShowGuideArgs.safeParse({
        title: "x",
        steps: [
          {
            point_at: { control: "pages", page_row: "/blog" },
            title: "a",
            text: "a",
          },
        ],
      }).success,
    ).toBe(false);
  });

  test("no steps, or more than eight, is refused", () => {
    const step = { title: "a", text: "a" };
    expect(ShowGuideArgs.safeParse({ title: "x", steps: [] }).success).toBe(
      false,
    );
    expect(
      ShowGuideArgs.safeParse({ title: "x", steps: Array(9).fill(step) })
        .success,
    ).toBe(false);
  });
});

describe("guideResult", () => {
  const base: Omit<GuideRequest, "state"> = { title: "x", stepCount: 3 };

  test("declined", () => {
    expect(guideResult({ ...base, state: { kind: "declined" } })).toMatchObject(
      { status: "declined" },
    );
  });

  test("finished, with how each step went", () => {
    expect(
      guideResult({
        ...base,
        state: {
          kind: "ended",
          outcome: {
            finished: true,
            reached: 3,
            steps: ["did-it", "done-for-them", "read"],
          },
        },
      }),
    ).toEqual({
      status: "finished",
      stepsTotal: 3,
      stepsReached: 3,
      steps: ["did-it", "done-for-them", "read"],
    });
  });

  test("stopped part way, back to the chat", () => {
    expect(
      guideResult({
        ...base,
        state: {
          kind: "ended",
          outcome: {
            finished: false,
            reached: 2,
            steps: ["did-it"],
            backToChat: true,
          },
        },
      }),
    ).toMatchObject({ status: "stopped", stepsReached: 2 });
  });
});

describe("guideTargetsOnScreen", () => {
  test("controls by name, and the rows of an open panel", () => {
    expect(
      guideTargetsOnScreen([
        // The phone's menu button stands in for four.
        "pages",
        "media",
        "data",
        "settings",
        "publish",
        // Not a control the assistant can name.
        "utility",
        "page:/",
        "page:/blog",
        "module:/content/footer.val.ts",
      ]),
    ).toEqual({
      controls: ["pages", "media", "data", "settings", "publish"],
      pageRows: ["/", "/blog"],
      moduleRows: ["/content/footer.val.ts"],
    });
  });
});

describe("createGuideCall", () => {
  const tour = () => ({
    start: jest.fn(),
    stop: jest.fn(),
    targetsOnScreen: () => [],
  });
  const call = () => {
    const onChange = jest.fn();
    const onAnswer = jest.fn();
    const built = guideTourSteps(
      parse({ title: "x", steps: [{ title: "a", text: "a" }] }),
    );
    if ("error" in built) throw new Error(built.error);
    return {
      onChange,
      onAnswer,
      guide: createGuideCall({
        title: "x",
        steps: built.steps,
        onChange,
        onAnswer,
      }),
    };
  };

  test("retired while offered: the card settles, nothing is answered, and it cannot start", () => {
    const { guide, onChange, onAnswer } = call();
    const shell = tour();
    guide.retire(shell);
    expect(onChange).toHaveBeenLastCalledWith(
      expect.objectContaining({ state: { kind: "declined" } }),
    );
    guide.start(shell);
    expect(shell.start).not.toHaveBeenCalled();
    expect(onAnswer).not.toHaveBeenCalled();
  });

  test("retired while showing: the tour closes, and nothing is answered", () => {
    const { guide, onAnswer } = call();
    const shell = tour();
    guide.start(shell);
    const run = shell.start.mock.calls[0][0];
    // The shell's stop closes the run, which tells it so.
    shell.stop.mockImplementation(() => run.onClose({ backToChat: false }));
    guide.retire(shell);
    expect(shell.stop).toHaveBeenCalledWith(run);
    expect(onAnswer).not.toHaveBeenCalled();
  });
});
