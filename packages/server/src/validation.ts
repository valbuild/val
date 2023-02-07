export type Ok = {
  kind: "ok";
  value: void;
};
export type Err<E> = {
  kind: "err";
  error: E;
};

export type Validation<E> = Ok | Err<E>;
export type Validator<T, E> = (value: T) => Validation<E>;

const OK: Ok = Object.freeze({
  kind: "ok",
  value: undefined,
});

export function ok(): Ok {
  return OK;
}

export function err<E>(error: E): Err<E> {
  return {
    kind: "err",
    error,
  };
}

export function isOk<E>(validation: Validation<E>): validation is Ok {
  return validation === OK || validation.kind === "ok";
}

export function isErr<E>(validation: Validation<E>): validation is Err<E> {
  return validation !== OK && validation.kind === "err";
}

/**
 * If all validations are Ok (or if validations is empty), returns Ok. If any
 * validation is Err, returns Err with all Err values concatenated into an
 * array.
 */
export function all<E>(
  validations: readonly Validation<E>[]
): Validation<[E, ...E[]]> {
  const errs: E[] = [];
  for (const validation of validations) {
    if (isErr(validation)) {
      errs.push(validation.error);
    }
  }
  if (errs.length > 0) {
    return err(errs as [E, ...E[]]);
  }
  return ok();
}
