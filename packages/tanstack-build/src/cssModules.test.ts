import { transformCssModule } from "./cssModules";

test("composes: is reported however it is laid out", async () => {
  for (const css of [
    `.title {\n  composes: base;\n}`,
    `.title { composes: base; color: red; }`,
    `.title { color: red; composes: base from "./other.module.css"; }`,
  ]) {
    const { warnings } = await transformCssModule("src/a.module.css", css);
    expect(warnings).toEqual([
      "src/a.module.css: composes: is not supported; the composed class is not merged.",
    ]);
  }
});

test("a property merely ending in composes is not reported", async () => {
  const { warnings } = await transformCssModule(
    "src/a.module.css",
    `.a { --x-composes: 1; }`,
  );
  expect(warnings).toEqual([]);
});
