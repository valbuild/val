import { object } from "./object";
import { Schema, SrcOf } from "./Schema";
import { string } from "./string";
import { literal, taggedUnion } from "./taggedUnion";

test("tagged union schema", () => {
  const helloS = object({
    d: literal("hello"),
    hello: string(),
  });
  const goodbyeS = object({
    d: literal("goodbye"),
    goodbye: string(),
  });
  const helloV: SrcOf<typeof helloS> = {
    d: "hello",
    hello: "hello",
  };
  const goodbyeV: SrcOf<typeof goodbyeS> = {
    d: "goodbye",
    goodbye: "goodbye",
  };

  const schema = taggedUnion("d", [helloS, goodbyeS]);

  expect(Schema.validate(schema, helloV)).toEqual(false);
  expect(Schema.validate(schema, goodbyeV)).toEqual(false);

  /* Schema.validate(schema, {
    d: "morning",
  }); */
});
