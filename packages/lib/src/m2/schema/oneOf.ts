/* eslint-disable @typescript-eslint/no-unused-vars */
import { Schema, SerializedSchema } from ".";
import { content } from "../module";
import { Selector, SelectorC } from "../selector";
import { Source } from "../Source";
import { SourcePath } from "../val";
import { selectorOf } from "../wrap";
import { array } from "./array";
import { number } from "./number";
import { object } from "./object";
import { string } from "./string";
import { union } from "./union";

type OneOfSelector<Sel extends Selector<Source[]>> = Sel extends SelectorC<
  infer S
>
  ? S extends (infer IS)[]
    ? IS extends Source
      ? Selector<IS>
      : never
    : never
  : never;

class OneOfSchema<Sel extends Selector<Source[]>> extends Schema<
  OneOfSelector<Sel>
> {
  constructor(readonly selector: Sel, readonly isOptional: boolean = false) {
    super();
  }
  validate(src: OneOfSelector<Sel>): false | Record<SourcePath, string[]> {
    throw new Error("Method not implemented.");
  }
  match(src: OneOfSelector<Sel>): boolean {
    throw new Error("Method not implemented.");
  }
  optional(): Schema<OneOfSelector<Sel> | undefined> {
    return new OneOfSchema(this.selector, true);
  }

  protected serialize(): SerializedSchema {
    throw new Error("Method not implemented.");
  }
}

export const oneOf = <Src extends Selector<Source[]>>(
  selector: Src
): Schema<OneOfSelector<Src>> => {
  return new OneOfSchema(selector);
};

{
  const base = content(
    "/base",
    array(
      union(
        "type",
        object({ type: string<"aoo">(), bar: string() }),
        object({ type: string<"boo">(), bar: string() }),
        object({
          type: string<"goo">(),
          foo: string(),
          test: number(),
          test2: array(number()).optional(),
          test3: object({ test: number() }).optional(),
          deep: object({
            homelander: object({ maeve: string(), starlight: string() }),
          }).optional(),
        })
      )
    ),
    []
  );
  const a = base[0];
  const base2 = content("/base2", oneOf(base), base[0]);

  base2.fold("type")({
    aoo: (a) => selectorOf(1),
    boo: (b) => selectorOf(2),
    goo: (c) => c.test,
  });
}

{
  const base = content(
    "/base",
    array(object({ type: string<"aoo">(), bar: string() })),
    []
  );
  const a = base[0];
  const base2 = content("/base2", oneOf(base).optional(), base[0]);
}
