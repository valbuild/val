import { I18nSelector } from "./i18n";
import { UndistributedSourceObject as ObjectSelector } from "./object";
import { UndistributedSourceArray as ArraySelector } from "./array";
import { Selector as NumberSelector } from "./number";
import { Selector as StringSelector } from "./string";
import { Selector as BooleanSelector } from "./boolean";
import { OptionalSelector as OptionalSelector } from "./optional";
import { AssetSelector } from "./asset";
import {
  FileSource,
  I18nSource,
  RemoteSource,
  Source,
  SourceArray,
  SourceObject,
} from "../Source";
import { SelectorC } from ".";

export default {};

type Selector<T extends Source> = T extends SourceObject
  ? ObjectSelector<NonNullable<T>> | OptionalSelector<T>
  : T extends string | undefined
  ? StringSelector<NonNullable<T>> | OptionalSelector<T>
  : T extends number | undefined
  ? NumberSelector<NonNullable<T>> | OptionalSelector<T>
  : never;

type T = Selector<number | string>;
type U = Selector<
  | number
  | {
      type: "foo";
      foo: string;
    }
  | {
      type: "bar";
      bar: number;
    }
  | string
>;
//goal:
//   Selector<string> |
//   Selector<number> |
//   Selector<
//     { type: "foo"; foo: string; } |
//     { type: "bar"; bar: number; }
//   >
