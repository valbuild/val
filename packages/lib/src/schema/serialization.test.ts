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
    deserialized: Schema<Source>;
  }[] = [
    {
      name: "array",
      serialized: {
        type: "array",
        schema: {
          type: "string",
        },
      },
      deserialized: new ArraySchema(new StringSchema()),
    },
    {
      name: "object",
      serialized: {
        type: "object",
        schema: {
          foo: {
            type: "string",
          },
        },
      },
      deserialized: new ObjectSchema({
        foo: new StringSchema(),
      }),
    },
    {
      name: "string",
      serialized: {
        type: "string",
      },
      deserialized: new StringSchema(),
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
