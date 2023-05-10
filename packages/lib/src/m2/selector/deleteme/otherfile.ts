import { array } from "../../schema/array";
import { number } from "../../schema/number";
import { object } from "../../schema/object";
import { string } from "../../schema/string";
import { union } from "./evenmoretests";

const t = union(
  "type",
  object({ type: string<"aoo">(), bar: string() }),
  object({ type: string<"boo">(), bar: string() }),
  object({ type: string<"coo">(), bar: string() }),
  object({ type: string<"doo">(), bar: string() }),
  object({ type: string<"eoo">(), bar: string() }),
  object({ type: string<"foo">(), foo: string() }),
  object({ type: string<"foo">(), foo: string() }),
  object({
    type: string<"goo">(),
    foo: string(),
    test2: array(number()).optional(),
    test3: object({ test: number() }).optional(),
    deep: object({
      homelander: object({ maeve: string(), starlight: string() }),
    }).optional(),
  }),
  object({ type: string<"hoo">(), foo: string(), test2: array(string()) }),
  object({ type: string<"ioo">(), foo: string(), test: array(string()) }),
  object({ type: string<"joo">(), foo: string() }),
  object({ type: string<"koo">(), foo: string() })
);

const a = t.fold("type")({
  aoo: (v) => ({ foo: v.bar }),
  boo: (v) => ({ foo: v.bar }),
  coo: (v) => ({ foo: v.bar }),
  doo: (v) => ({ foo: v.bar }),
  eoo: (v) => ({ foo: v.bar }),
  foo: (v) => ({ foo: v.foo }),
  goo: (v) => ({ foo: v.foo }),
  hoo: (v) => ({ foo: v.foo }),
  ioo: (v) => ({ foo: v.foo }),
  joo: (v) => ({ foo: v.foo }),
  koo: (v) => ({ foo: v.foo }),
});
