import { array } from "../schema/array";
import { object } from "../schema/object";
import { string } from "../schema/string";
import { LENS } from "./selector";

test("selector", () => {
  const source = {
    foo: {
      bar: [
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

  const rootSelector = schema.select();
  const selector = rootSelector.foo.bar[0].baz;
  const selectedValue = selector[LENS]().apply(source);
  expect(selectedValue).toEqual("baz");
});
