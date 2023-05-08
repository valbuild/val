import {
  Selector as UnknownSelector,
  SelectorC,
  SelectorOf,
  SelectorSource,
} from ".";
import { Schema } from "../schema";
import { Source, SourceArray, SourceObject } from "../Source";
import { Selector as BooleanSelector } from "./boolean";

export type UndistributedSourceArray<T extends SourceArray> = [T] extends [
  infer U // infer here to avoid Type instantiation is excessively deep and possibly infinite. See: https://github.com/microsoft/TypeScript/issues/30188#issuecomment-478938437. Avoiding infer extends to keep us below TS 4.9 compat
]
  ? U extends SourceArray
    ? Selector<U>
    : never
  : never;

// TODO: docs
type Selector<T extends SourceArray> = SelectorC<T> & {
  readonly [key in keyof T & number]: UnknownSelector<T[key]>;
} & {
  filter(
    predicate: (v: UnknownSelector<T[number]>) => BooleanSelector<boolean>
  ): SelectorOf<T>;
  filter<U extends T[number]>(schema: Schema<U>): SelectorOf<U[]>;
  map<U extends SelectorSource>(
    f: (v: UnknownSelector<T[number]>, i: UnknownSelector<number>) => U
  ): SelectorOf<U[]>;
  andThen<U extends SelectorSource>(
    f: (v: UnknownSelector<NonNullable<T>>) => U
  ): SelectorOf<U> | UnknownSelector<boolean>;
};
// & (T[number] extends SourceObject
//     ? {
//         // TODO: remove this?
//         /**
//          *
//          * @deprecated use `filter` with a schema instead
//          *
//          * @example
//          *
//          */
//         filterMatch<U extends keyof T[number], V extends T[number][U]>(v: {
//           [key in U]: V;
//         }): T[number][U] extends never
//           ? never // removes all matches that does not have the key  `U`
//           : SelectorOf<
//               (T[number] & {
//                 // removes matches that do not have this exact value
//                 [key in U]: V;
//               })[]
//             >;
//       }
//     : unknown);
