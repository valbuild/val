/* eslint-disable @typescript-eslint/no-unused-vars */
import { Schema, SerializedSchema } from ".";
import { RichTextSource, RichTextOptions } from "../source/richtext";
import { SourcePath } from "../val";
import { ValidationErrors } from "./validation/ValidationError";

export type SerializedRichTextSchema = RichTextOptions & {
  type: "richtext";
  opt: boolean;
};

export class RichTextSchema<
  O extends RichTextOptions,
  Src extends RichTextSource<O> | null
> extends Schema<Src> {
  constructor(readonly options: O, readonly opt: boolean = false) {
    super();
  }

  validate(path: SourcePath, src: Src): ValidationErrors {
    return false; //TODO
  }

  assert(src: Src): boolean {
    return true; // TODO
  }

  optional(): Schema<RichTextSource<O> | null> {
    return new RichTextSchema(this.options, true);
  }

  serialize(): SerializedSchema {
    return {
      type: "richtext",
      opt: this.opt,
    };
  }
}

export const richtext = <O extends RichTextOptions>(
  options: O
): Schema<RichTextSource<O>> => {
  return new RichTextSchema<O, RichTextSource<O>>(options);
};
