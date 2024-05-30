/* eslint-disable @typescript-eslint/no-unused-vars */
import { Schema, SerializedSchema } from ".";
import { RichTextSource, RichTextOptions } from "../source/richtext";
import { SourcePath } from "../val";
import { ValidationErrors } from "./validation/ValidationError";

export type SerializedRichTextSchema = {
  type: "richtext";
  opt: boolean;
  options: RichTextOptions;
};

export class RichTextSchema<
  O extends RichTextOptions,
  Src extends RichTextSource<O> | null
> extends Schema<Src> {
  constructor(readonly options: O, readonly opt: boolean = false) {
    super();
  }

  validate(path: SourcePath, src: Src): ValidationErrors {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    if ((src as any)?.markdownish) {
      return {
        [path]: [
          {
            message: "Replace markdown with structured format",
            value: src,
            fixes: ["fix:deprecated-richtext"],
          },
        ],
      };
    }
    return false; //TODO
  }

  assert(src: Src): boolean {
    return true; // TODO
  }

  nullable(): Schema<RichTextSource<O> | null> {
    return new RichTextSchema(this.options, true);
  }

  serialize(): SerializedSchema {
    return {
      type: "richtext",
      opt: this.opt,
      options: this.options,
    };
  }
}

export const richtext = <O extends RichTextOptions>(
  options?: O
): Schema<RichTextSource<O>> => {
  return new RichTextSchema<O, RichTextSource<O>>(options ?? ({} as O));
};
