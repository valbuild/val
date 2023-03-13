import { ModuleContent } from "./content";
import * as lens from "./lens";
import { Schema } from "./schema/Schema";
import { Source } from "./Source";

export class ValModule<T extends Schema<Source, unknown>> {
  constructor(
    public readonly id: string,
    public readonly content: ModuleContent<T>
  ) {}
}

/**
 *
 * @deprecated Uncertain about the name of this
 */
export const content = <T extends Schema<Source, unknown>>(
  id: string,
  schema: T,
  src: lens.InOf<T>
): ValModule<T> => {
  return new ValModule(id, new ModuleContent(src, schema));
};
