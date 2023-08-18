/* eslint-disable @typescript-eslint/no-unused-vars */
import { Schema, SerializedSchema } from ".";
import { RichTextSource } from "../source/richtext";
import { SourcePath } from "../val";
import { ValidationErrors } from "./validation/ValidationError";

export type SerializedRichTextSchema = {
  type: "richtext";
  opt: boolean;
};

export class RichTextSchema<
  Src extends RichTextSource | null
> extends Schema<Src> {
  validate(path: SourcePath, src: Src): ValidationErrors {
    throw new Error("Method not implemented.");
  }
  assert(src: Src): boolean {
    // TODO:
    return true;
  }

  optional(): Schema<RichTextSource | null> {
    return new RichTextSchema(true);
  }
  serialize(): SerializedSchema {
    return {
      type: "richtext",
      opt: this.opt,
    };
  }
  constructor(readonly opt: boolean = false) {
    super();
  }
}

export const richtext = (): Schema<RichTextSource> => {
  return new RichTextSchema();
};
