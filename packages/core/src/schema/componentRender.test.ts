import { initVal } from "../initVal";
import type { ReadOf } from "../read";
import {
  type ComponentArgs,
  componentPropsOf,
  getComponentRender,
  loadComponent,
} from "../render";
import type { ValComponent } from "../source/component";
import type { SelectorOfSchema } from "./index";

const { s, c } = initVal();

function Hero(props: { title: string }) {
  return props.title;
}
function Quote(props: { quote: string }) {
  return props.quote;
}

const hero = s
  .object({ type: s.literal("hero"), title: s.string() })
  .component(() => Promise.resolve({ default: Hero }), {
    example: { type: "hero", title: "A very long title" },
  });
const quote = s
  .object({ type: s.literal("quote"), quote: s.string() })
  .component(() => Promise.resolve({ default: Quote }));

describe("s.object(...).component(...)", () => {
  test("serialize: a marker, never the component", () => {
    expect(hero["executeSerialize"]()).toMatchObject({
      type: "object",
      render: { as: "component", example: true },
    });
    const serialized = quote["executeSerialize"]();
    expect(serialized.type === "object" && serialized.render).toEqual({
      as: "component",
      example: undefined,
    });
  });

  test("serialize: the sizes and the default view travel whole", () => {
    const schema = s
      .object({ title: s.string() })
      .component(() => Promise.resolve({ default: Hero }), {
        maxWidth: 400,
        aspectRatio: 16 / 9,
        defaultView: "preview",
      });
    const serialized = schema["executeSerialize"]();
    expect(serialized.type === "object" && serialized.render).toEqual({
      as: "component",
      maxWidth: 400,
      aspectRatio: 16 / 9,
      defaultView: "preview",
    });
  });

  test("throws where it is defined on a size no preview can have", () => {
    const object = s.object({ title: s.string() });
    const component = () => Promise.resolve({ default: Hero });
    expect(() => object.component(component, { maxWidth: 0 })).toThrow(
      /maxWidth must be a positive number/,
    );
    expect(() => object.component(component, { aspectRatio: -1 })).toThrow(
      /aspectRatio must be a positive number/,
    );
    expect(() =>
      object.component(component, { aspectRatio: Infinity }),
    ).toThrow(/aspectRatio/);
  });

  test("serialize: no render by default", () => {
    const serialized = s.object({ a: s.string() })["executeSerialize"]();
    expect(serialized.type === "object" && serialized.render).toBe(undefined);
  });

  test("survives the other modifiers", () => {
    const schema = hero.describe("A hero").nullable().readonly();
    expect(getComponentRender(schema, null)?.example).toEqual({
      type: "hero",
      title: "A very long title",
    });
  });

  test("a discriminated union answers for the variant the value takes", async () => {
    const union = s.discriminatedUnion("type", hero, quote);
    const ofQuote = getComponentRender(union, { type: "quote", quote: "Hi" });
    expect(ofQuote && (await loadComponent(ofQuote))).toBe(Quote);
    const ofHero = getComponentRender(union, { type: "hero", title: "Hi" });
    expect(ofHero && (await loadComponent(ofHero))).toBe(Hero);
    expect(getComponentRender(union, { type: "unknown" })).toBe(null);
    expect(getComponentRender(union, null)).toBe(null);
  });

  test("anything else has no component", () => {
    expect(getComponentRender(s.string(), "a")).toBe(null);
    expect(getComponentRender(s.array(hero), [])).toBe(null);
  });

  test("without a props function, the value is the props", () => {
    const render = getComponentRender(hero, { type: "hero", title: "Hi" });
    const value = { type: "hero", title: "Hi" };
    expect(render && componentPropsOf(render, value)).toBe(value);
  });

  test("a props function makes the props of a component that has its own", () => {
    const banner = s
      .object({ heading: s.string(), shout: s.boolean() })
      .component(() => Promise.resolve({ default: Hero }), {
        props: (value) => ({
          title: value.shout ? `${value.heading}!` : value.heading,
        }),
      });
    const render = getComponentRender(banner, null);
    expect(
      render && componentPropsOf(render, { heading: "Hello", shout: true }),
    ).toEqual({ title: "Hello!" });
    // A closure, like the component: only the marker is serialized
    const serialized = banner["executeSerialize"]();
    expect(serialized.type === "object" && serialized.render).toEqual({
      as: "component",
      example: undefined,
    });
  });

  test("types: what follows the thunk depends on whether the fields are the props", () => {
    // `[] extends Args` is "the options may be left out"
    type MayOmitOptions<Args extends unknown[]> = [] extends Args
      ? true
      : false;
    type ArgsOf<S extends typeof hero | typeof headed, C> = ComponentArgs<
      NonNullable<SelectorOfSchema<S>>,
      ReadOf<NonNullable<SelectorOfSchema<S>>>,
      C
    >;
    const headed = s.object({ heading: s.string() });

    // Fields that are the props (and one more, `type`): nothing else needed
    const fieldsAreProps: MayOmitOptions<ArgsOf<typeof hero, typeof Hero>> =
      true;
    // `heading` is not `title`: options, with `props`, are required
    const fieldsAreNotProps: MayOmitOptions<
      ArgsOf<typeof headed, typeof Hero>
    > = false;
    // A component that takes nothing can be handed anything
    const noProps: MayOmitOptions<ArgsOf<typeof headed, () => string>> = true;
    // A class component is read through its constructor
    class Classy {
      constructor(public props: { heading: string }) {}
    }
    const classProps: MayOmitOptions<ArgsOf<typeof headed, typeof Classy>> =
      true;
    expect([fieldsAreProps, fieldsAreNotProps, noProps, classProps]).toEqual([
      true,
      false,
      true,
      true,
    ]);
    // The values behind the types above, so they are not there for the
    // compiler alone
    expect(headed["executeSerialize"]().type).toBe("object");
    expect(new Classy({ heading: "Hi" }).props.heading).toBe("Hi");
  });

  test("types: a linked object reads as a ValComponent, and nothing else does", () => {
    const unlinked = s.object({ type: s.literal("plain"), text: s.string() });
    const schema = s.object({
      sections: s.array(s.discriminatedUnion("type", hero, quote)),
      mixed: s.array(s.discriminatedUnion("type", hero, unlinked)),
      plain: s.array(unlinked),
      single: hero,
      maybe: quote.nullable(),
    });
    // The link costs the source nothing: these are plain literals
    const pageVal = c.define("/page.val.ts", schema, {
      sections: [
        { type: "hero", title: "Hi" },
        { type: "quote", quote: "Hello" },
      ],
      mixed: [{ type: "plain", text: "Hi" }],
      plain: [],
      single: { type: "hero", title: "Hi" },
      maybe: null,
    });
    expect(pageVal).toBeDefined();
    type Page = ReadOf<SelectorOfSchema<typeof schema>>;
    type IsComponent<T> = [T] extends [ValComponent] ? true : false;

    const everyVariantLinked: IsComponent<Page["sections"][number]> = true;
    // One variant without a component: the list is not a list of components
    const oneVariantUnlinked: IsComponent<Page["mixed"][number]> = false;
    const noComponent: IsComponent<Page["plain"][number]> = false;
    const single: IsComponent<Page["single"]> = true;
    const nullable: IsComponent<NonNullable<Page["maybe"]>> = true;
    const stillNullable: null extends Page["maybe"] ? true : false = true;
    // Its fields are all still there, typed as before
    const title: Page["single"]["title"] extends string ? true : false = true;
    expect([
      everyVariantLinked,
      oneVariantUnlinked,
      noComponent,
      single,
      nullable,
      stillNullable,
      title,
    ]).toEqual([true, false, false, true, true, true, true]);
  });
});
