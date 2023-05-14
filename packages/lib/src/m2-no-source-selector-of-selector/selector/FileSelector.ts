import { Selector as PrimitiveSelector } from "./PrimitiveSelector";
import { GenericSelector, SelectorExtensionBrand } from "./Selector";

export const File = Symbol("File");
export type Selector = GenericSelector<{ url: string }> & {
  readonly url: PrimitiveSelector<string>;
  readonly [File]: string;
  readonly [SelectorExtensionBrand]: "file";
};
