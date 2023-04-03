import { Source } from "../Source";
import { ArraySchema } from "./array";
import { ObjectSchema } from "./object";
import { Schema, SerializedSchema } from "./Schema";
import { deserializeSchema } from "./serialization";
import { StringSchema } from "./string";

describe("Schema", () => {
  const testCases: {
    name: string;
    serialized: SerializedSchema;
    deserialized: Schema<never, Source>;
  }[] = [
    {
      name: "array",
      serialized: {
        type: "array",
        schema: {
          type: "string",
          opt: false,
        },
        opt: false,
      },
      deserialized: new ArraySchema(new StringSchema(undefined, false), false),
    },
    {
      name: "object",
      serialized: {
        type: "object",
        schema: {
          foo: {
            type: "string",
            opt: false,
          },
        },
        opt: false,
      },
      deserialized: new ObjectSchema(
        {
          foo: new StringSchema(undefined, false),
        },
        false
      ),
    },
    {
      name: "string",
      serialized: {
        type: "string",
        opt: false,
      },
      deserialized: new StringSchema(undefined, false),
    },
  ];

  test.each(testCases)("deserialize $name", ({ serialized, deserialized }) => {
    expect(deserializeSchema(serialized)).toEqual(deserialized);
  });

  test.each(testCases)("serialize $name", ({ serialized, deserialized }) => {
    expect(deserialized.serialize()).toEqual(serialized);
  });

  test.each(testCases)(
    "serialization/deserialization of $name is isomorphic",
    ({ deserialized }) => {
      expect(deserializeSchema(deserialized.serialize())).toEqual(deserialized);
    }
  );
});
