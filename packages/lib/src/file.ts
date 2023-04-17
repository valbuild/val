export type FileSrc<Ref extends string> = {
  ref: Ref;
};

export function file<F extends string>(ref: F): FileSrc<F> {
  return { ref };
}
