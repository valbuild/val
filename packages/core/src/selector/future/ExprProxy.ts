import { Selector, SelectorSource, SourceOrExpr } from ".";
import * as expr from "../../expr/expr";
import { Source, SourcePrimitive } from "../../source";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyFun = (...args: any[]) => any;

export function newExprSelectorProxy<T extends Source>(
  root: expr.Expr,
  depth = 0
): Selector<T> {
  return new Proxy(new GenericExprSelector(root, depth), {
    get: (target, prop) => {
      if (prop === SourceOrExpr) {
        return target[SourceOrExpr];
      }
      if (!hasOwn(target, prop)) {
        return newExprSelectorProxy(
          new expr.Call([new expr.StringLiteral(prop.toString()), root], false),
          depth
        );
      }
      return Reflect.get(target, prop);
    },
  }) as unknown as Selector<T>;
}

class GenericExprSelector {
  [SourceOrExpr]: expr.Expr;
  constructor(private readonly root: expr.Expr, private readonly depth = 0) {
    this[SourceOrExpr] = root;
  }

  andThen = (f: AnyFun) => {
    return genericHigherOrderFunction(this.root, "andThen", f, 1, this.depth);
  };

  map = (f: AnyFun) => {
    return genericHigherOrderFunction(this.root, "map", f, 2, this.depth);
  };

  filter = (f: AnyFun) => {
    return genericHigherOrderFunction(this.root, "filter", f, 1, this.depth);
  };

  eq = (other: SourcePrimitive) => {
    return newExprSelectorProxy(
      new expr.Call(
        [
          new expr.Sym("eq"),
          this.root,
          typeof other === "string"
            ? new expr.StringLiteral(other)
            : typeof other === "undefined"
            ? expr.NilSym
            : convertLiteralProxy(other),
        ],
        false
      ),
      this.depth
    );
  };
}

function genericHigherOrderFunction(
  root: expr.Expr,
  name: string,
  f: AnyFun,
  args: number,
  depth: number
) {
  const argsExprs: Selector<Source>[] = [];
  for (let i = 0; i < args; i++) {
    argsExprs.push(
      newExprSelectorProxy(new expr.Sym(`@[${depth},${i}]`), depth + 1)
    );
  }
  return newExprSelectorProxy(
    new expr.Call(
      [new expr.Sym(name), root, convertLiteralProxy(f(...argsExprs))],
      true
    ),
    depth
  );
}

function hasOwn<T extends PropertyKey>(obj: object, prop: T): boolean {
  return Object.prototype.hasOwnProperty.call(obj, prop);
}

export function convertLiteralProxy(
  source: expr.Expr | SelectorSource
): expr.Expr {
  const [convertedLiteral] = convertObjectToStringExpr(source, true);
  return withJsonCall(convertedLiteral, false)[0];
}

/**
 * Add a json call if the literal must be parsed
 * Happens at the very least at the top level, but may also happen inside e.g. a string template
 *
 */
function withJsonCall(
  e: expr.Expr,
  isLiteralScope: boolean
): [e: expr.Expr, isJson: boolean] {
  if (
    !isLiteralScope &&
    (e instanceof expr.StringLiteral || e instanceof expr.StringTemplate)
  ) {
    return [new expr.Call([new expr.Sym("json"), e], false), true];
  }
  return [e, false];
}

function convertObjectToStringExpr(
  source: expr.Expr | SelectorSource,
  isLiteralScope: boolean
): [e: expr.Expr, isJson: boolean] {
  if (source === null || source === undefined) {
    return [expr.NilSym, true];
  } else if (typeof source === "string") {
    return [new expr.StringLiteral(JSON.stringify(source)), false];
  } else if (typeof source === "number" || typeof source === "boolean") {
    return withJsonCall(
      new expr.StringLiteral(source.toString()),
      isLiteralScope
    );
  } else if (typeof source === "object" && SourceOrExpr in source) {
    const selector = source;
    const valOrExpr = selector[SourceOrExpr];
    if (valOrExpr instanceof expr.Expr) {
      return [valOrExpr, true];
    } else {
      // use Val literal - UNTESTED - may happen if we are referencing local content
      return convertObjectToStringExpr(valOrExpr, isLiteralScope);
    }
  } else if (source instanceof expr.Expr) {
    return [source, true];
  } else if (typeof source === "object") {
    // source is a literal object or array, might have nested selectors
    const isArray = Array.isArray(source);
    const entries = isArray
      ? Array.from(source.entries())
      : Object.entries(source);

    let isStringTemplate = false;
    const converted = entries.map(([key, v]) => {
      const [converted, mustInterpolate] =
        typeof v === "string"
          ? withJsonCall(
              new expr.StringLiteral(JSON.stringify(v)),
              isLiteralScope
            )
          : convertObjectToStringExpr(v, isLiteralScope);

      isStringTemplate = isStringTemplate || mustInterpolate;
      return [key, converted] as const;
    });

    if (!isStringTemplate) {
      const value = isArray
        ? `[${converted.map(([, v]) => getStringLiteralValue(v)).join(", ")}]`
        : `{${converted
            .map(
              ([key, v]) =>
                `${JSON.stringify(key)}: ${getStringLiteralValue(v)}`
            )
            .join(", ")}}`;

      return [new expr.StringLiteral(value), false];
    }

    return [
      new expr.StringTemplate([
        isArray ? new expr.StringLiteral("[") : new expr.StringLiteral("{"),
        ...converted.flatMap(([key, entry], i) => {
          const convertedEntry =
            typeof entry === "string"
              ? new expr.StringLiteral(JSON.stringify(entry))
              : convertObjectToStringExpr(entry, isLiteralScope)[0];
          const maybeComma =
            i < converted.length - 1 ? [new expr.StringLiteral(", ")] : [];
          if (isArray) {
            return [convertedEntry].concat(maybeComma);
          } else {
            return [
              new expr.StringLiteral(JSON.stringify(key) + ": "),
              convertedEntry,
            ].concat(maybeComma);
          }
        }),
        isArray ? new expr.StringLiteral("]") : new expr.StringLiteral("}"),
      ]),
      true,
    ];
  }
  throw new Error(
    `Unsupported type '${typeof source}': ${JSON.stringify(source)}`
  );
}

function getStringLiteralValue(e: expr.Expr): string {
  if (e instanceof expr.StringLiteral) {
    return e.value;
  } else {
    throw new Error(`expected a string literal but found: ${e.transpile()}`);
  }
}
