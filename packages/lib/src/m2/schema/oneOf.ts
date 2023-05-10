/* eslint-disable @typescript-eslint/no-unused-vars */
import { Schema, SerializedSchema } from ".";
import { Selector, SelectorOf, SelectorSource, SourceOf } from "../selector";
import { Source } from "../Source";
import { SourcePath } from "../val";

class OneOfSchema<
  Src extends Source,
  Sel extends Selector<Src[]>
> extends Schema<Selector<Src>> {
  validate(src: Selector<Src>): false | Record<SourcePath, string[]> {
    throw new Error("Method not implemented.");
  }
  match(src: Selector<Src>): boolean {
    throw new Error("Method not implemented.");
  }
  optional(): Schema<Selector<Src> | undefined> {
    throw new Error("Method not implemented.");
  }

  constructor(readonly selector: Sel) {
    super();
  }
  protected serialize(): SerializedSchema {
    throw new Error("Method not implemented.");
  }
}

/////////////////

// type SchemaSrcOf<T extends Schema<SelectorSource>> = T extends Schema<infer Src>
//   ? Src
//   : never;

// type ValModule<T extends SelectorSource> = SelectorOf<T>;

// export function content<T extends Schema<SelectorSource>>(
//   // eslint-disable-next-line @typescript-eslint/no-unused-vars
//   id: string,
//   // eslint-disable-next-line @typescript-eslint/no-unused-vars
//   schema: T,
//   // eslint-disable-next-line @typescript-eslint/no-unused-vars
//   source: SchemaSrcOf<T>
// ): ValModule<SchemaSrcOf<T>> {
//   throw Error("Not implemented");
// }

export const oneOf = <Src extends Source>(
  selector: Selector<Src[]>
): Schema<Selector<Src>> => {
  throw Error("");
};

// {
//   const base = content("/base", array(string()), ["test"]);
//   const base2 = content("/base2", oneOf(base), base[0]);
// }
