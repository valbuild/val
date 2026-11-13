/** @jest-environment jsdom */
import {
  componentOfValue,
  initVal,
  Internal,
  loadComponent,
} from "@valbuild/core";
import { act, render, screen } from "@testing-library/react";
import {
  stegaClean,
  stegaEncode,
  type ResolvedVal,
} from "../stega/stegaEncode";
import { ValComponentEditor } from "./ValComponentEditor";
import {
  isHorizontal,
  moveTarget,
  relativeTo,
  slotAt,
  VAL_COMPONENT_ATTRIBUTE,
  VAL_COMPONENT_LIST_ATTRIBUTE,
} from "./ValComponentEditorChrome";

const { s, c } = initVal();

/** Thunks called, so a component loaded when it should not be is countable. */
let loaded: string[] = [];

function Hero(props: { title: string }) {
  return <h1>{props.title}</h1>;
}
function Quote(props: { quote: string }) {
  return <blockquote>{props.quote}</blockquote>;
}
/** A component with props of its own, as a design system's would be. */
function Callout(props: { heading: string; tone: "info" | "warning" }) {
  return <aside data-tone={props.tone}>{props.heading}</aside>;
}
/** A component that renders a list of components itself. */
function Columns(props: { cards: ResolvedVal<typeof pageVal>["cards"] }) {
  return <ValComponentEditor value={props.cards} className="cards" />;
}

const hero = s
  .object({ type: s.literal("hero"), title: s.string() })
  .component(() => {
    loaded.push("hero");
    return Promise.resolve({ default: Hero });
  });
const quote = s
  .object({ type: s.literal("quote"), quote: s.string() })
  .component(() => {
    loaded.push("quote");
    return Promise.resolve({ default: Quote });
  });
const note = s
  .object({
    type: s.literal("note"),
    text: s.string(),
    important: s.boolean(),
  })
  .component(
    () => {
      loaded.push("note");
      return Promise.resolve({ default: Callout });
    },
    {
      props: (value) => ({
        heading: value.text,
        tone: value.important ? "warning" : "info",
      }),
    },
  );
const card = s.object({ title: s.string() }).component(() => {
  loaded.push("card");
  return Promise.resolve({ default: Hero });
});
const plain = s.object({ text: s.string() });

const pageSchema = s.object({
  sections: s.array(s.discriminatedUnion("type", hero, quote, note)),
  single: hero,
  maybe: quote.nullable(),
  empty: s.array(hero),
  cards: s.array(card),
  plain,
});
const pageVal = c.define("/page.val.ts", pageSchema, {
  sections: [
    { type: "hero", title: "Welcome" },
    { type: "quote", quote: "So it goes" },
    { type: "note", text: "Mind the gap", important: true },
  ],
  single: { type: "hero", title: "Alone" },
  maybe: null,
  empty: [],
  cards: [{ title: "One" }, { title: "Two" }],
  plain: { text: "No component" },
});

beforeEach(() => {
  loaded = [];
});

/** The page as a reader gives it back: in draft mode, or as on the live site. */
function read(opts: { production?: boolean } = {}) {
  const page: ResolvedVal<typeof pageVal> = stegaEncode(pageVal, {
    disabled: opts.production === true,
  });
  return page;
}

describe("a read value carries the component its schema links it to", () => {
  test("each item of a union, by the variant it takes", async () => {
    const page = read();
    const [first, second, third] = page.sections;
    const components = await Promise.all(
      [first, second, third].map((item) => {
        const linked = componentOfValue(item);
        return linked && loadComponent(linked);
      }),
    );
    expect(components).toEqual([Hero, Quote, Callout]);
  });

  test("a single object, and not one whose schema has no component", () => {
    const page = read();
    expect(componentOfValue(page.single)).not.toBe(null);
    expect(componentOfValue(page.plain)).toBe(null);
  });

  test("in production too, where nothing else is tagged", () => {
    const page = read({ production: true });
    expect(componentOfValue(page.sections[0])).not.toBe(null);
    // No path there: the editing on the page has nothing to hold on to
    expect(Internal.valPathOf(page.sections[0])).toBe(undefined);
    expect(Internal.valPathOf(page.sections)).toBe(undefined);
  });

  test("a list knows where it was read from, an empty one included", () => {
    const page = read();
    expect(Internal.valPathOf(page.sections)).toBe('/page.val.ts?p="sections"');
    expect(Internal.valPathOf(page.empty)).toBe('/page.val.ts?p="empty"');
    expect(Internal.valPathOf(page.sections[1])).toBe(
      '/page.val.ts?p="sections".1',
    );
  });

  test("it is the DRAFT's item that decides, not the bundle's", async () => {
    // An editor turned the first section into a quote: the source in the
    // store says so, and the module's own source does not.
    const page: ResolvedVal<typeof pageVal> = stegaEncode(pageVal, {
      getModule: () => ({
        ...Internal.getSource(pageVal),
        sections: [{ type: "quote", quote: "Changed" }],
      }),
    });
    const linked = componentOfValue(page.sections[0]);
    expect(linked && (await loadComponent(linked))).toBe(Quote);
  });

  test("reading is lazy: no component's code is asked for", () => {
    read();
    expect(loaded).toEqual([]);
  });

  test("the value is still only its content to anything that reads it as data", () => {
    const page = read({ production: true });
    expect(Object.keys(page.single)).toEqual(["type", "title"]);
    expect(JSON.parse(JSON.stringify(page.single))).toEqual({
      type: "hero",
      title: "Alone",
    });
    // Which is also why it does not survive being serialized: what a client
    // component is handed by a server component has no component on it.
    expect(componentOfValue(JSON.parse(JSON.stringify(page.single)))).toBe(
      null,
    );
  });
});

describe("ValComponentEditor", () => {
  /** Rendered, and every lazy component it shows loaded. */
  async function show(ui: React.ReactElement) {
    const view = render(ui);
    await act(async () => {
      await Promise.resolve();
    });
    return view;
  }

  test("a list: every item by its own component, in order", async () => {
    const page = read({ production: true });
    const { container } = await show(
      <ValComponentEditor value={page.sections} className="sections" />,
    );
    expect(await screen.findByRole("heading")).toHaveProperty(
      "textContent",
      "Welcome",
    );
    const list = container.querySelector(`[${VAL_COMPONENT_LIST_ATTRIBUTE}]`);
    expect(list?.className).toBe("sections");
    const items = Array.from(
      list?.querySelectorAll(`:scope > [${VAL_COMPONENT_ATTRIBUTE}]`) ?? [],
    );
    expect(items.map((item) => item.firstElementChild?.tagName)).toEqual([
      "H1",
      "BLOCKQUOTE",
      "ASIDE",
    ]);
    // Only what the page shows was loaded
    expect(loaded.sort()).toEqual(["hero", "note", "quote"]);
  });

  test("a props function makes the props of a component that has its own", async () => {
    const page = read({ production: true });
    const { container } = await show(
      <ValComponentEditor value={page.sections} />,
    );
    await screen.findByRole("heading");
    const aside = container.querySelector("aside");
    expect(aside?.textContent).toBe("Mind the gap");
    expect(aside?.getAttribute("data-tone")).toBe("warning");
  });

  test("a single object, and nothing for a null one", async () => {
    const page = read({ production: true });
    const { container } = await show(
      <>
        <ValComponentEditor value={page.single} itemClassName="one" />
        <ValComponentEditor value={page.maybe} />
      </>,
    );
    expect((await screen.findByRole("heading")).textContent).toBe("Alone");
    // One component, no list around it
    expect(
      container.querySelectorAll(`[${VAL_COMPONENT_LIST_ATTRIBUTE}]`).length,
    ).toBe(0);
    const items = container.querySelectorAll(`[${VAL_COMPONENT_ATTRIBUTE}]`);
    expect(items.length).toBe(1);
    expect(items[0]?.className).toBe("one");
  });

  test("in draft mode an item is tagged with its path, and in production it is not", async () => {
    const draft = await show(<ValComponentEditor value={read().sections} />);
    await screen.findByRole("heading");
    const tagged = draft.container.querySelectorAll(
      `[${VAL_COMPONENT_ATTRIBUTE}]`,
    );
    expect(tagged[1]?.getAttribute("data-val-path")).toBe(
      '/page.val.ts?p="sections".1',
    );
    expect(
      draft.container
        .querySelector(`[${VAL_COMPONENT_LIST_ATTRIBUTE}]`)
        ?.getAttribute(VAL_COMPONENT_LIST_ATTRIBUTE),
    ).toBe('/page.val.ts?p="sections"');
    draft.unmount();

    const live = await show(
      <ValComponentEditor value={read({ production: true }).sections} />,
    );
    await screen.findByRole("heading");
    expect(live.container.querySelector("[data-val-path]")).toBe(null);
  });

  test("components inside a component: a list rendered by one of the items", async () => {
    const page = read();
    const { container } = await show(<Columns cards={page.cards} />);
    const headings = await screen.findAllByRole("heading");
    // Draft content: each string carries its edit tag, which is not text
    expect(
      headings.map((heading) => stegaClean(heading.textContent ?? "")),
    ).toEqual(["One", "Two"]);
    expect(
      container
        .querySelector(".cards")
        ?.getAttribute(VAL_COMPONENT_LIST_ATTRIBUTE),
    ).toBe('/page.val.ts?p="cards"');
  });

  test("outside the Studio's canvas there are no controls", async () => {
    const { container } = await show(
      <ValComponentEditor value={read().sections} />,
    );
    await screen.findByRole("heading");
    expect(container.querySelector("[data-val-component-controls]")).toBe(null);
    expect(container.querySelector("button")).toBe(null);
  });
});

describe("arranging a list on the page", () => {
  const down = [
    { top: 0, left: 0, width: 400, height: 100 },
    { top: 100, left: 0, width: 400, height: 200 },
    { top: 300, left: 0, width: 400, height: 100 },
  ];
  const across = [
    { top: 0, left: 0, width: 100, height: 80 },
    { top: 0, left: 110, width: 100, height: 80 },
    { top: 0, left: 220, width: 100, height: 80 },
  ];

  test("a list runs across when its items sit side by side", () => {
    expect(isHorizontal(down)).toBe(false);
    expect(isHorizontal(across)).toBe(true);
    // One item, or none, has no direction: down
    expect(isHorizontal([across[0]])).toBe(false);
    expect(isHorizontal([])).toBe(false);
  });

  test("an item gives way once the pointer has passed its middle", () => {
    expect(slotAt(down, { x: 10, y: 10 })).toBe(0);
    expect(slotAt(down, { x: 10, y: 60 })).toBe(1);
    expect(slotAt(down, { x: 10, y: 190 })).toBe(1);
    expect(slotAt(down, { x: 10, y: 210 })).toBe(2);
    expect(slotAt(down, { x: 10, y: 999 })).toBe(3);
    // Across, it is the x that counts
    expect(slotAt(across, { x: 40, y: 500 })).toBe(0);
    expect(slotAt(across, { x: 170, y: 0 })).toBe(2);
    expect(slotAt(across, { x: 400, y: 0 })).toBe(3);
  });

  test("the slots on either side of an item are where it already is", () => {
    expect(moveTarget(1, 1)).toBe(null);
    expect(moveTarget(1, 2)).toBe(null);
    expect(moveTarget(1, 0)).toBe(0);
    // Past itself: taking it out moves everything after it up one
    expect(moveTarget(1, 3)).toBe(2);
    expect(moveTarget(0, 3)).toBe(2);
    expect(moveTarget(2, 0)).toBe(0);
  });

  test("positions are taken from where the controls' layer really is", () => {
    expect(
      relativeTo(
        { top: 120, left: 80, width: 10, height: 20 },
        { x: 30, y: 100 },
      ),
    ).toEqual({ top: 20, left: 50, width: 10, height: 20 });
  });
});
