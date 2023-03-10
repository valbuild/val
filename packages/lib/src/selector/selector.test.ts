import * as lens from "../lens";
import { getSelector } from ".";
import { array } from "../schema/array";
import { object } from "../schema/object";
import { string } from "../schema/string";
import { LENS } from "./selector";

test("selector", () => {
  const source = {
    foo: {
      bar: [
        {
          baz: "foo",
        },
        {
          baz: "bar",
        },
        {
          baz: "baz",
        },
      ],
    },
  };
  const schema = object({
    foo: object({
      bar: array(
        object({
          baz: string(),
        })
      ),
    }),
  });

  const rootSelector = getSelector(
    lens.identity<typeof source>(),
    schema.descriptor()
  );
  const selector = rootSelector.foo.bar[0].baz;
  const selectedValue = selector[LENS]().apply(source);
  expect(selectedValue).toEqual("foo");
});
