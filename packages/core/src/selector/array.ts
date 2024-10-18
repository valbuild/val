import { GenericSelector } from ".";
import { Source, SourceArray } from "../source";

export type UndistributedSourceArray<T extends SourceArray> = [T] extends [
  infer U, // infer here to avoid Type instantiation is excessively deep and possibly infinite. See: https://github.com/microsoft/TypeScript/issues/30188#issuecomment-478938437. Avoiding infer extends to keep us below TS 4.9 compat
]
  ? U extends Source[]
    ? Selector<U>
    : never
  : never;

// TODO: docs
export type Selector<T extends SourceArray> = GenericSelector<T>;
