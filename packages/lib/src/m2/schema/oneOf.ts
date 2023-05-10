/* eslint-disable @typescript-eslint/no-unused-vars */
import { SerializedSchema } from ".";
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

//////////

type StringOptions = {
  maxLength?: number;
  minLength?: number;
};

export type SerializedStringSchema = {
  type: "string";
  options?: StringOptions;
  opt: boolean;
};

export class StringSchema<Src extends string | undefined> extends Schema<Src> {
  constructor(
    readonly options?: StringOptions,
    readonly isOptional: boolean = false
  ) {
    super();
  }

  validate(src: Src): false | Record<SourcePath, string[]> {
    throw new Error("Method not implemented.");
  }

  match(src: Src): boolean {
    if (this.isOptional && src === undefined) {
      return true;
    }
    return typeof src === "string";
  }

  optional(): Schema<Src | undefined> {
    return new StringSchema<Src | undefined>(this.options, true);
  }

  protected serialize(): SerializedSchema {
    throw new Error("Method not implemented.");
  }
}

export const string = <T extends string>(
  options?: StringOptions
): Schema<T> => {
  return new StringSchema();
};

export type SerializedArraySchema = {
  type: "array";
  schema: Record<string, SerializedSchema>;
  opt: boolean;
};

export class ArraySchema<T extends Schema<Source>> extends Schema<
  SchemaSrcOf<T>[]
> {
  constructor(readonly item: T, readonly isOptional: boolean = false) {
    super();
  }

  validate(src: SchemaSrcOf<T>[]): false | Record<SourcePath, string[]> {
    throw new Error("Method not implemented.");
  }

  match(src: SchemaSrcOf<T>[]): boolean {
    if (this.isOptional && src === undefined) {
      return true;
    }
    if (!src) {
      return false;
    }

    // TODO: checks all items
    return typeof src === "object" && Array.isArray(src);
  }

  optional(): Schema<SchemaSrcOf<T>[] | undefined> {
    return new ArraySchema(this.item, true);
  }

  protected serialize(): SerializedSchema {
    throw new Error("Method not implemented.");
  }
}

export const array = <Src extends Source>(
  schema: Schema<Src>
): Schema<Src[]> => {
  return new ArraySchema(schema);
};

/////////////////

type SchemaSrcOf<T extends Schema<SelectorSource>> = T extends Schema<infer Src>
  ? Src
  : never;

type ValModule<T extends SelectorSource> = SelectorOf<T>;

export function content<T extends Schema<SelectorSource>>(
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  id: string,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  schema: T,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  source: SchemaSrcOf<T>
): ValModule<SchemaSrcOf<T>> {
  throw Error("Not implemented");
}

export const oneOf = <Src extends Source>(
  selector: Selector<Src[]>
): Schema<Selector<Src>> => {
  throw Error("");
};

{
  const base = content("/base", array(string()), ["test"]);
  const base2 = content("/base2", oneOf(base), base[0]);
}
