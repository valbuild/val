import {
  GenericSelectorObject,
  GenericSelector,
  JsonOfSelector,
} from "./Selector";

export type Selector<S extends GenericSelectorObject> = GenericSelector<
  JsonOfSelector<S>
> & {
  readonly [key in keyof S]: S[key];
};
