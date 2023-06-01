import {
  Selector as UnknownSelector,
  GenericSelector,
  SelectorOf,
  SelectorSource,
} from ".";

// TODO: docs
export type FileSelector = GenericSelector<{ url: string }> & {
  readonly url: UnknownSelector<string>;
  andThen<U extends SelectorSource>(
    f: (v: UnknownSelector<NonNullable<{ url: string }>>) => U
  ): SelectorOf<U> | UnknownSelector<boolean>;
};
