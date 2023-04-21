import { Source } from "../Source";
import { DESC, EXPR, Selected, Selector, newSelector } from ".";
import {
  Descriptor,
  filter,
  IS,
  NullDescriptor,
  UnionDescriptor,
} from "../descriptor2";
import { expr } from "..";

// eslint-disable-next-line @typescript-eslint/ban-types -- Shush, non-null is intended!
type NonNull<V extends Source> = V & {};

export function andThen<V extends NonNull<Source>, Ctx, U extends Source>(
  s: Selector<V | null, Ctx>,
  callback: <Ctx1>(v: Selector<V, Ctx1>) => Selected<U, Ctx1>
): Selector<U | null, Ctx> {
  const vDesc = filter<V | null, V>(
    s[DESC],
    (desc): desc is Descriptor<V> => !desc[IS](null)
  );

  type Ctx1 = readonly [V];
  const selector = newSelector<V, Ctx1>(vDesc, expr.fromCtx(0));
  const out = callback<Ctx1>(selector);
  const outDesc = UnionDescriptor.create<U | null>([out[DESC], NullDescriptor]);
  const outExpr = expr.andThen<Ctx, V, U>(s[EXPR], out[EXPR]);
  return newSelector(outDesc, outExpr);
}
