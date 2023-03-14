import { ModuleContent } from "./content";
import { Schema, SourceOf } from "./schema/Schema";
import { Source } from "./Source";

export class ValModule<T extends Schema<Source>> {
  constructor(
    public readonly id: string,
    public readonly content: ModuleContent<T>
  ) {}
}

/**
 *
 * @deprecated Uncertain about the name of this
 */
export const content = <T extends Schema<Source>>(
  id: string,
  schema: T,
  src: SourceOf<T>
): ValModule<T> => {
  return new ValModule(id, new ModuleContent(src, schema));
};
