/* eslint-disable @typescript-eslint/no-unused-vars */
import { Schema, SerializedSchema } from "..";
import { ValModuleBrand } from "../../module";
import { GenericSelector } from "../../selector/future";
import { RichTextSelector } from "../../selector/richtext";
import { Source, SourceArray } from "../../source";
import { RichTextSource } from "../../source/richtext";
import { SourcePath } from "../../val";
import { ValidationErrors } from "../validation/ValidationError";

export type SerializedOneOfSchema = {
  type: "oneOf";
  selector: SourcePath;
  opt: boolean;
};

type OneOfSelector<Sel extends GenericSelector<SourceArray>> =
  Sel extends GenericSelector<infer S>
    ? S extends RichTextSource<infer O>
      ? RichTextSelector<O>
      : S extends (infer IS)[]
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
  validate(path: SourcePath, src: OneOfSelector<Sel>): ValidationErrors {
    throw new Error("Method not implemented.");
  }
  assert(src: OneOfSelector<Sel>): boolean {
    throw new Error("Method not implemented.");
  }
  nullable(): Schema<OneOfSelector<Sel> | null> {
    return new OneOfSchema(this.selector, true);
  }

  serialize(): SerializedSchema {
    throw new Error("Method not implemented.");

    // const path = getValPath(this.selector);
    // if (!path) {
    //   throw new Error(
    //     "Cannot serialize oneOf schema with empty selector. Make sure a Val module is used."
    //   );
    // }
    // return {
    //   type: "oneOf",
    //   selector: path,
    //   opt: this.opt,
    // };
  }
}

export const oneOf = <
  Src extends GenericSelector<SourceArray> & ValModuleBrand // ValModuleBrand enforces call site to pass in a val module - selectors are not allowed. The reason is that this should make it easier to patch. We might be able to relax this constraint in the future
>(
  valModule: Src
): Schema<OneOfSelector<Src>> => {
  return new OneOfSchema(valModule);
};
