/* eslint-disable @typescript-eslint/no-unused-vars */
import { Schema, SerializedSchema } from ".";
import { ValModuleBrand } from "../module";
import { GenericSelector } from "../selector";
import { Source, SourceArray } from "../source";
import { getValPath, SourcePath } from "../val";

export type SerializedOneOfSchema = {
  type: "oneOf";
  selector: SourcePath;
  opt: boolean;
};

type OneOfSelector<Sel extends GenericSelector<SourceArray>> =
  Sel extends GenericSelector<infer S>
    ? S extends (infer IS)[]
      ? IS extends Source
        ? GenericSelector<IS>
        : never
      : never
    : never;

export class OneOfSchema<
  Sel extends GenericSelector<SourceArray>
> extends Schema<OneOfSelector<Sel>> {
  constructor(readonly selector: Sel, readonly opt: boolean = false) {
    super();
  }
  validate(src: OneOfSelector<Sel>): false | Record<SourcePath, string[]> {
    throw new Error("Method not implemented.");
  }
  match(src: OneOfSelector<Sel>): boolean {
    throw new Error("Method not implemented.");
  }
  optional(): Schema<OneOfSelector<Sel> | null> {
    return new OneOfSchema(this.selector, true);
  }

  serialize(): SerializedSchema {
    const path = getValPath(this.selector);
    if (!path) {
      throw new Error(
        "Cannot serialize oneOf schema with empty selector. Make sure a Val module is used."
      );
    }
    return {
      type: "oneOf",
      selector: path,
      opt: this.opt,
    };
  }
}

export const oneOf = <
  Src extends GenericSelector<SourceArray> & ValModuleBrand // ValModuleBrand enforces call site to pass in a val module - selectors are not allowed. The reason is that this should make it easier to patch. We might be able to relax this constraint in the future
>(
  valModule: Src
): Schema<OneOfSelector<Src>> => {
  return new OneOfSchema(valModule);
};