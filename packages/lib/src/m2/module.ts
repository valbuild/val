import { Schema, SchemaSrcOf } from "./schema";
import { string } from "./schema/string";
import { object } from "./schema/object";
import { Selector, Source } from "./selector";

export type ValModule<T> = {};

export function content<T extends Schema<Source, Selector<Source>>>(
  id: string,
  schema: T,
  source: SchemaSrcOf<T>
): ValModule<{}> {
  return {
    id,
    schema,
    source,
  };
}

{
  content(
    "/id",
    object({
      foo: string(),
    }),
    {
      foo: "bar",
    }
  ).foo;
}
