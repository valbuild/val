import { array } from "../../schema/array";
import { content } from "../../module";
import { number } from "../../schema/number";
import { object } from "../../schema/object";
import { oneOf } from "../../schema/oneOf";
import { string } from "../../schema/string";
import { remote } from "../../Source";
import { selectorOf } from "../selectorOf";
import { union } from "../../schema/union";

{
  const base = content(
    "/base",
    array(
      union(
        "type",
        object({ type: string<"aoo">(), bar: string() }),
        object({ type: string<"boo">(), bar: string() }),
        object({ type: string<"doo">(), bar: string() }),
        object({
          type: string<"goo">(),
          foo: string(),
          test: number(),
          test2: array(number()).optional(),
          test3: object({ test: number() }).optional(),
          deep: object({
            homelander: object({
              maeve: string(),
              starlight: number(),
              aTrain: number(),
              blackNoir: object({
                test: string(),
              }),
            }),
          }).optional(),
        })
      )
    ).remote(),
    remote("")
  );
  const base2 = content("/base2", oneOf(base), base[0]);

  const b = base2.fold("type")({
    aoo: (a) => selectorOf(1),
    boo: (a) => selectorOf(1),
    goo: (a) => a.test,
    doo: (a) => selectorOf(1),
  });
}

{
  const base = content(
    "/base",
    array(object({ type: string<"aoo">(), bar: string() })).remote(),
    remote("")
  );
  const a = base[0];
  const base2 = content("/base2", oneOf(base), base[0]);
  base2.bar;
}
