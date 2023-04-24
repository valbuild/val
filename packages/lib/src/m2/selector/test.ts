import { Selector } from ".";

const ex = "" as unknown as Selector<
  readonly { readonly title: string; readonly bar: string }[]
>;
const out = ex.map((v) => v);
out[0].title;
out[0].title.eq("");
