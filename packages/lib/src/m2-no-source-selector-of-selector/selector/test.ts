import { RemoteSource } from "../Source";
import { Selector } from "./Selector";
// import { Selector as ArraySelector } from "./ArraySelector";
// import { Selector as ObjectSelector } from "./ObjectSelector";
// import { Selector as PrimitiveSelector } from "./PrimitiveSelector";
// import { Selector as RemoteSelector } from "./RemoteSelector";
// import { Selector, Selectors, ValOrExpr } from "./Selector";

// TODO: remove:
{
  const a = null as unknown as Selector<undefined>;
  const b = a.eq("");
}
{
  const a = null as unknown as Selector<null>;
  const b = a.eq("");
}
{
  const a = null as unknown as Selector<string | undefined>;
  const b = a.eq("");
}
{
  const a = null as unknown as Selector<(string | undefined)[]>;
  const b = a.length;
  a.filter((v) => v.eq(""));
  a.filter((v) => v);
}
{
  const a = null as unknown as Selector<{
    test: { test: string }[];
  }>;
  const b = a.test[0].test.eq("");
}
{
  const a = null as unknown as Selector<{
    test: readonly RemoteSource<string>[];
  }>;
  const b = a.test[0].eq("");
}
// {
//   const a = null as unknown as Selector<{
//     test: readonly RemoteSelector<PrimitiveSelector<string>>[];
//   }>;
//   const b = a.test[0].eq("");
// }
// {
//   const a = null as unknown as Selector<
//     ArraySelector<readonly RemoteSelector<PrimitiveSelector<string>>[]>
//   >;
//   const b = a[0].eq("");
// }
// {
//   const a: Selectors = null as unknown as ObjectSelector<{
//     test: ArraySelector<readonly PrimitiveSelector<string>[]>;
//   }>;
//   const b = a[ValOrExpr];
// }
// {
//   const a = null as unknown as Selector<
//     ObjectSelector<{
//       test: ArraySelector<readonly PrimitiveSelector<string>[]>;
//     }>
//   >;
//   const b = a.test[0].eq("");
// }
