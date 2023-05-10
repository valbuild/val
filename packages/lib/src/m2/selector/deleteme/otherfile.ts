import { Selector } from "..";
import { number } from "../../schema/number";
import { object } from "../../schema/object";
import { string } from "../../schema/string";
import { union } from "./evenmoretests";

// const t = union(
//   object({ type: string<"foo">(), foo: string() }),
//   object({ type: string<"zoo">(), bar: string() })
// );

// const a = t.fold("type", {
//   foo: (v) => 1,
//   // zoo: (v) => v.bar,
// });
