import { isNonEmpty, NonEmptyArray } from "./nonEmptyArray";

export type Ok<T> = {
  readonly kind: "ok";
  readonly value: T;
};
export type Err<E> = {
  readonly kind: "err";
  readonly error: E;
};

export type Result<T, E> = Ok<T> | Err<E>;

/**
 * Singleton instance of Ok<void>. Used to optimize results whose Ok values are
 * void.
 */
export const voidOk: Ok<void> = Object.freeze({
  kind: "ok",
  value: undefined,
});

export function ok<T>(value: T): Ok<T> {
  if (value === undefined) return voidOk as Ok<T>;
  return {
    kind: "ok",
    value,
  };
}

export function err<E>(error: E): Err<E> {
  return {
    kind: "err",
    error,
  };
}

export function isOk<T, E>(result: Result<T, E>): result is Ok<T> {
  return result === voidOk || result.kind === "ok";
}

export function isErr<T, E>(result: Result<T, E>): result is Err<E> {
  return result !== voidOk && result.kind === "err";
}

export type OkType<R> = R extends Result<infer T, unknown> ? T : never;
export type ErrType<R> = R extends Result<unknown, infer E> ? E : never;

/**
 * If all results are Ok (or if results is empty), returns Ok with all the Ok
 * values concatenated into an array. If any result is Err, returns Err with all
 * Err values concatenated into an array.
 *
 * @see {@link all} for use with simple array types.
 */
export function allT<T extends unknown[], E>(results: {
  readonly [P in keyof T]: Result<T[P], E>;
}): Result<T, NonEmptyArray<E>> {
  const values: T[number][] = [];
  const errors: E[] = [];
  for (const result of results) {
    if (isOk(result)) {
      values.push(result.value);
    } else {
      errors.push(result.error);
    }
  }
  if (isNonEmpty(errors)) {
    return err(errors);
  } else {
    return ok(values as T);
  }
}

/**
 * If all results are Ok (or if results is empty), returns Ok with all the Ok
 * values concatenated into an array. If any result is Err, returns Err with all
 * Err values concatenated into an array.
 *
 * @see {@link allT} for use with tuple types.
 */
export function all<T, E>(
  results: readonly Result<T, E>[]
): Result<T[], NonEmptyArray<E>> {
  return allT<T[], E>(results);
}

/**
 * If all results are Ok (or if results is empty), returns Ok. If any result is
 * Err, returns Err with all Err values concatenated into an array.
 */
export function allV<E>(
  results: readonly Result<unknown, E>[]
): Result<void, NonEmptyArray<E>> {
  const errs: E[] = [];
  for (const result of results) {
    if (isErr(result)) {
      errs.push(result.error);
    }
  }
  if (isNonEmpty(errs)) {
    return err(errs);
  }
  return voidOk;
}

/**
 * Perform a reduction over an array with a Result-returning reducer. If the
 * reducer returns Ok, its value is used as the next value. If the reducer
 * returns Err, it is returned immediately.
 *
 * flatMapReduce is a short-circuiting equivalent to:
 * ```
 * arr.reduce(
 *   (accRes, current, currentIndex) =>
 *     flatMap((acc) => reducer(acc, current, currentIndex))(accRes),
 *   ok(initVal)
 * )
 * ```
 */
export function flatMapReduce<T, E, A>(
  reducer: (acc: T, current: A, currentIndex: number) => Result<T, E>,
  initVal: T
): (arr: readonly A[]) => Result<T, E> {
  return (arr) => {
    let val: Result<T, E> = ok(initVal);
    for (let i = 0; i < arr.length && isOk(val); ++i) {
      val = reducer(val.value, arr[i], i);
    }
    return val;
  };
}

export function map<T0, T1>(
  onOk: (value: T0) => T1
): <E>(result: Result<T0, E>) => Result<T1, E> {
  return (result) => {
    if (isOk(result)) {
      return ok(onOk(result.value));
    } else {
      return result;
    }
  };
}

export function flatMap<T0, T1, E1>(
  onOk: (value: T0) => Result<T1, E1>
): <E>(result: Result<T0, E>) => Result<T1, E | E1> {
  return (result) => {
    if (isOk(result)) {
      return onOk(result.value);
    } else {
      return result;
    }
  };
}

export function mapErr<E0, E1>(
  onErr: (error: E0) => E1
): <T>(result: Result<T, E0>) => Result<T, E1> {
  return (result) => {
    if (isErr(result)) {
      return err(onErr(result.error));
    } else {
      return result;
    }
  };
}

export function fromPredicate<T0, T1 extends T0, E>(
  refinement: (value: T0) => value is T1,
  onFalse: (value: T0) => E
): (value: T0) => Result<T1, E>;
export function fromPredicate<T0, E>(
  refinement: (value: T0) => boolean,
  onFalse: (value: T0) => E
): <T1 extends T0>(value: T1) => Result<T1, E> {
  return (value) => {
    if (refinement(value)) {
      return ok(value);
    } else {
      return err(onFalse(value));
    }
  };
}

export function filterOrElse<T0, T1 extends T0, E>(
  refinement: (value: T0) => value is T1,
  onFalse: (value: T0) => E
): (result: Result<T0, E>) => Result<T1, E>;
export function filterOrElse<T0, E>(
  refinement: (value: T0) => boolean,
  onFalse: (value: T0) => E
): <T1 extends T0>(result: Result<T1, E>) => Result<T1, E> {
  return (result) => {
    if (isOk(result)) {
      if (refinement(result.value)) {
        return result;
      } else {
        return err(onFalse(result.value));
      }
    } else {
      return result;
    }
  };
}
