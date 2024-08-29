import {
  GenericSelector,
  Schema,
  SelectorOf,
  SelectorSource,
} from "@valbuild/core";
import { SelectorOfSchema } from "@valbuild/core";
import { StegaOfSource } from "@valbuild/react/stega";

export type UseValType<T extends SelectorSource> =
  SelectorOf<T> extends GenericSelector<infer S> ? StegaOfSource<S> : never;

export type inferSchema<S extends Schema<SelectorSource>> = UseValType<
  SelectorOfSchema<S>
>;
