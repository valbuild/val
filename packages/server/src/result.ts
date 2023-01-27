export type Ok<T> = {
  kind: "ok";
  value: T;
};
export type Err<E> = {
  kind: "err";
  error: E;
};

export type Result<T, E> = Ok<T> | Err<E>;

export function ok<T>(value: T): Ok<T> {
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
  return result.kind === "ok";
}

export function isErr<T, E>(result: Result<T, E>): result is Err<E> {
  return result.kind === "err";
}

type OkType<R> = R extends Result<infer T, unknown> ? T : never;
type ErrType<R> = R extends Result<unknown, infer E> ? E : never;

export function all<T extends unknown[], E>(results: {
  readonly [P in keyof T]: Result<T[P], E>;
}): Result<T, E[]> {
  const values: T[number][] = [];
  const errors: E[] = [];
  for (const result of results) {
    if (isOk(result)) {
      values.push(result.value);
    } else {
      errors.push(result.error);
    }
  }
  if (errors.length > 0) {
    return err(errors);
  } else {
    return ok(values as T);
  }
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
