import { ModuleContent } from "./content";
import { Schema, SrcOf } from "./schema/Schema";
import { Source } from "./Source";

export class ValModule<T extends Source> {
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
  src: SrcOf<T>
): ValModule<SrcOf<T>> => {
  return new ValModule(id, new ModuleContent<SrcOf<T>>(src, schema));
};
