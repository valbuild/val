import { Source, SourceObject } from "../Source";
import { DESC, EXPR, newSelector, Selected, Selector } from ".";
import { expr } from "..";
import { Descriptor, filter, IS, UnionDescriptor } from "../descriptor2";

export type CaseCallback<in In extends Source, out Out extends Source> = <Ctx>(
  v: Selector<In, Ctx>
) => Selected<Out, Ctx>;
export type CaseOutput<C> = C extends <Ctx>(
  v: Selector<never, Ctx>
) => Selected<infer Out, Ctx>
  ? Out
  : never;

type MatchableValue<K extends string> = {
  [P in K]: string;
};

type Matcher<K extends string, in V extends MatchableValue<K>> = {
  [U in V as U[K]]: <Ctx>(event: Selector<U, Ctx>) => Selected<Source, Ctx>;
};

export function match<
  K extends string,
  M extends Matcher<K, V>,
  V extends MatchableValue<K>,
  Ctx
>(
  s: Selector<V, Ctx>,
  discriminator: K,
  matcher: M
): Selector<CaseOutput<M[keyof M]>, Ctx> {
  const desc = s[DESC];
  const entries = Object.entries(
    matcher as unknown as { [s: string]: CaseCallback<V, Source> }
  ).map(([key, callback]) => {
    const vDesc = filter(
      desc,
      (desc): desc is Descriptor<V> =>
        discriminator in desc &&
        (desc as Descriptor<SourceObject>)[discriminator][IS](key)
    );

    type Ctx1 = readonly [V];
    const selector = newSelector<V, Ctx1>(vDesc, expr.fromCtx(0));
    return [key as V[K], callback(selector)] as const;
  });

  const outDesc = UnionDescriptor.create(
    entries.map(
      ([, selected]) => selected[DESC] as Descriptor<CaseOutput<M[keyof M]>>
    )
  );
  const outExpr = expr.match<Ctx, K, V, CaseOutput<M[keyof M]>>(
    s[EXPR],
    discriminator,
    Object.fromEntries(
      entries.map(([key, selected]) => [key, selected[EXPR]] as const)
    ) as {
      [U in V as U[K]]: expr.Expr<readonly [V], CaseOutput<M[keyof M]>>;
    }
  );
  return newSelector(outDesc, outExpr);
}
