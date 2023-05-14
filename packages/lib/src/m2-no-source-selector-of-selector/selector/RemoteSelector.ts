import { JsonPrimitive } from "../Json";
import { Selector as ArraySelector } from "./ArraySelector";
import { Selector as FileSelector } from "./FileSelector";
import { Selector as I18nSelector } from "./I18nSelector";
import { Selector as ObjectSelector } from "./ObjectSelector";
import { Selector as PrimitiveSelector } from "./PrimitiveSelector";
import {
  GenericSelectorObject,
  GenericSelectorArray,
  SelectorExtensionBrand,
} from "./Selector";

/// Remote

export const RemoteRef = Symbol("RemoteRef");
export type RemoteCompatibleSelectors =
  | PrimitiveSelector<JsonPrimitive>
  | I18nSelector<
      string[],
      | PrimitiveSelector<JsonPrimitive>
      | ObjectSelector<GenericSelectorObject>
      | ArraySelector<GenericSelectorArray>
      | FileSelector
    >
  | ObjectSelector<GenericSelectorObject>
  | ArraySelector<GenericSelectorArray>;
export type Selector<S extends RemoteCompatibleSelectors> = S & {
  readonly [RemoteRef]: string;
  readonly [SelectorExtensionBrand]: "remote";
};
