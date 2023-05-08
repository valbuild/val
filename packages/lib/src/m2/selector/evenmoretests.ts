import { DistributedSelector, Selector } from ".";
import { Schema } from "../schema";
import { number } from "../schema/number";
import { object } from "../schema/object";
import { string } from "../schema/string";
import { Source, SourceObject } from "../Source";

const union = <T extends Schema<SourceObject>[]>(
  ...object: T
): T extends Schema<infer S>[] ? DistributedSelector<S> : never => {
  throw Error("unimplemented");
};

const t = union(
  object({ type: string<"foo">(), foo: string() }),
  object({ type: string<"bar">(), bar: number() })
);

t.fold("type")({
  foo: (v) => v.foo as DistributedSelector<string | number>,
  bar: (v) => v.bar as DistributedSelector<string | number>,
});
