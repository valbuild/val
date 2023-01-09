import { object } from "./schema/object";
import { SerializedSchema } from "./schema/SerializedSchema";
import { StaticVal } from "./StaticVal";
import { ValidTypes } from "./ValidTypes";

/**
 *
 * @deprecated Uncertain about the name of this
 */
export class ValContent<T extends ValidTypes> {
  constructor(public readonly id: string, public readonly val: StaticVal<T>) {}
}

/**
 *
 * @deprecated Uncertain about the name of this
 */
export const content = <T extends ValidTypes>(
  id: string,
  f: () => StaticVal<T>
): ValContent<T> => {
  return new ValContent(id, f());
};
