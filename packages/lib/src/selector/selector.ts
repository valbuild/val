import * as lens from "../lens";

/**
 * @internal
 */
export const LENS: unique symbol = Symbol("lens");

export interface Selector<Src, Out> {
  eq(value: Out): Selector<Src, boolean>;
  [LENS](): lens.Lens<Src, Out>;
}

export abstract class BaseSelector<Src, Out> implements Selector<Src, Out> {
  abstract [LENS](): lens.Lens<Src, Out>;
  eq(value: Out | Selector<Src, Out>): Selector<Src, boolean> {
    return new EqSelector<Src, Out>(this[LENS], value);
  }
}

class EqSelector<Src, Out>
  extends BaseSelector<Src, boolean>
  implements Selector<Src, boolean>
{
  constructor(
    private readonly fromSrc: lens.Lens<Src, Out>,
    private readonly value: Out | Selector<Src, Out>
  ) {
    super();
  }

  [LENS](): lens.Lens<Src, boolean> {
    if (
      typeof this.value === "object" &&
      this.value !== null &&
      LENS in this.value
    ) {
      // value is a selector
      return lens.compose(this.fromSrc, {
        // TODO: Do proper deep equals
        apply: (input: Out): boolean =>
          input ===
          (this.value as Selector<Src, Out>)[LENS].apply(this.fromSrc),
      });
    } else {
      return lens.compose(this.fromSrc, {
        // TODO: Do proper deep equals
        apply: (input: Out): boolean => input === this.value,
      });
    }
  }
}
