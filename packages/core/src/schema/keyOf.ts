/* eslint-disable @typescript-eslint/no-unused-vars */
import { Schema, SerializedSchema, SourceObject, initVal } from "..";
import { ValModuleBrand } from "../module";
import { GenericSelector, Selector } from "../selector";
import { SourceArray } from "../source";
import { SourcePath } from "../val";
import { array } from "./array";
import { number } from "./number";
import { object } from "./object";
import { record } from "./record";
import { string } from "./string";
import { ValidationErrors } from "./validation/ValidationError";

export type SerializedKeyOfSchema = {
  type: "keyOf";
  selector: SourcePath;
  opt: boolean;
};

type KeyOfSelector<Sel extends GenericSelector<SourceArray | SourceObject>> =
  Sel extends GenericSelector<infer S>
    ? S extends readonly any[]
      ? number
      : S extends SourceObject
      ? keyof S
      : S extends Record<string, any>
      ? string
      : never
    : never;

export class KeyOfSchema<
  Sel extends GenericSelector<SourceArray | SourceObject>
> extends Schema<KeyOfSelector<Sel>> {
  constructor(readonly selector: Sel, readonly opt: boolean = false) {
    super();
  }
  validate(path: SourcePath, src: KeyOfSelector<Sel>): ValidationErrors {
    throw new Error("Method not implemented.");
  }
  assert(src: KeyOfSelector<Sel>): boolean {
    throw new Error("Method not implemented.");
  }
  optional(): Schema<KeyOfSelector<Sel> | null> {
    return new KeyOfSchema(this.selector, true);
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

export const keyOf = <
  Src extends GenericSelector<SourceArray | SourceObject> & ValModuleBrand // ValModuleBrand enforces call site to pass in a val module - selectors are not allowed. The reason is that this should make it easier to patch. We might be able to relax this constraint in the future
>(
  valModule: Src
): Schema<KeyOfSelector<Src>> => {
  return new KeyOfSchema(valModule);
};
