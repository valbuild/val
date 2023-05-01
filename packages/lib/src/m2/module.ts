import { Schema, SchemaSrcOf } from "./schema";
import { string } from "./schema/string";
import { object } from "./schema/object";
import { Selector } from "./selector";
import { Source } from "./Source";

export type ValModule<T extends Source> = Selector<T>;

export function content<T extends Schema<Source>>(
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  id: string,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  schema: T,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  source: SchemaSrcOf<T>
): ValModule<SchemaSrcOf<T>> {
  throw Error("Not implemented");
}

{
  const s = object({
    foo: string(),
  });
  const a = content("/id", s, {
    foo: "bar",
  });
  a.foo;
}
