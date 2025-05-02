/* eslint-disable @typescript-eslint/no-explicit-any */
import { Schema, SelectorOfSchema } from ".";
import { SelectorSource } from "../selector";
import { FILE_REF_PROP } from "../source/file";
import { ImageSource } from "../source/image";
import { SourcePath } from "../val";
import { image } from "./image";
import { number } from "./number";
import { object } from "./object";
import { RecordSchema, record } from "./record";
import { string } from "./string";

describe("RecordSchema", () => {
  test("assert: basic record", () => {
    const schema = record(number().nullable());
    expect(schema.assert("foo" as SourcePath, { bar: 1 })).toEqual({
      success: true,
      data: { bar: 1 },
    });
  });

  test("types", () => {
    const schema = record(
      object({
        name: string(),
        metadata: object({ foo: string(), image: image() }).nullable(),
      }),
    );
    type TestInput = typeof schema;
    type GetItemSchemaOfRecord<
      T extends RecordSchema<
        Schema<SelectorSource>,
        Record<string, any> | null
      >,
    > = T extends RecordSchema<Schema<infer Child>, any> ? Child : never;

    type InnerType = GetItemSchemaOfRecord<TestInput>;

    type ImageSource = {
      readonly [FILE_REF_PROP]: string;
    };
    type Test2 = {
      test1: string;
      test2: string;
      test3: number;
      metadata: {
        zoo: string;
        foo: {
          bar: string;
        };
        image: ImageSource;
      };
    };
    const FILE_REF_PROP = "_ref" as const;

    type PathOfTarget<T, Target> = {
      [K in keyof T]: T[K] extends Target
        ? K
        : T[K] extends { [FILE_REF_PROP]: string }
          ? never
          : T[K] extends Record<string, any>
            ? `${K & string}.${PathOfTarget<T[K], Target> & string}`
            : never;
    }[keyof T];
    const a: PathOfTarget<Test2, string> = "test1";
  });
});
