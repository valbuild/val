import { initVal } from "../initVal";
import { getComponentRender, loadComponent } from "../render";

const { s } = initVal();

function Hero(props: { title: string }) {
  return props.title;
}
function Quote(props: { quote: string }) {
  return props.quote;
}

const hero = s.object({ type: s.literal("hero"), title: s.string() }).render({
  as: "component",
  component: () => Promise.resolve({ default: Hero }),
  example: { type: "hero", title: "A very long title" },
});
const quote = s
  .object({ type: s.literal("quote"), quote: s.string() })
  .render({ as: "component", component: () => Promise.resolve(Quote) });

describe("s.object(...).render({ as: 'component' })", () => {
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
    const schema = s.object({ title: s.string() }).render({
      as: "component",
      component: () => Promise.resolve(Hero),
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
    const component = () => Promise.resolve(Hero);
    expect(() =>
      object.render({ as: "component", component, maxWidth: 0 }),
    ).toThrow(/maxWidth must be a positive number/);
    expect(() =>
      object.render({ as: "component", component, aspectRatio: -1 }),
    ).toThrow(/aspectRatio must be a positive number/);
    expect(() =>
      object.render({ as: "component", component, aspectRatio: Infinity }),
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
});
