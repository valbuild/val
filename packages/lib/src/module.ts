import { ModuleContent } from "./content";
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
export const content = <T extends Source>(
  id: string,
  f: () => ModuleContent<T>
): ValModule<T> => {
  return new ValModule(id, f());
};
