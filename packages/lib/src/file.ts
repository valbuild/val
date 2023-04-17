declare const brand: unique symbol;

export type FileSrc<Ref extends string> = {
  ref: Ref;
  [brand]: "ValFileSrc";
};

export function file<F extends string>(ref: F): FileSrc<F> {
  return { ref } as FileSrc<F>;
}
