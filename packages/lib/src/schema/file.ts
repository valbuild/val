import { Schema } from "./Schema";

type FileOptions = {
  // TODO:
};

export type SerializedFileSchema = {
  type: "file";
  options: FileOptions;
};

class FileSchema extends Schema<{}> {
  constructor(private readonly options?: FileOptions) {
    super();
  }

  validate(input: string): false | string[] {
    return false;
  }

  serialize(): SerializedFileSchema {
    return {
      type: "file",
      options: {},
    };
  }
}
export const file = (options?: FileOptions): Schema<string> => {
  return new FileSchema(options);
};
