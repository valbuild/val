/* eslint-disable @typescript-eslint/no-explicit-any */
import { Call, Expr, StringLiteral, StringTemplate, Sym } from "./expr";
import { Source } from "../source";
import { result } from "../fp";
import { Path, SourceOrExpr } from "../selector";
import { newSelectorProxy } from "../selector/SelectorProxy";
import { isSerializedVal, SourcePath } from "../val";

export class EvalError {
  constructor(public readonly message: string, public readonly expr: Expr) {}

  toString() {
    return `${this.message} in: ${this.expr.transpile()}`;
  }
}

type LocalSelector<S extends Source> = {
  readonly [key: string | number]:
    | LocalSelector<Source>
    | ((...args: any[]) => any);
} & {
  [SourceOrExpr]: S;
  [Path]: SourcePath | undefined;
};

const MAX_STACK_SIZE = 100; // an arbitrary semi-large number
async function evaluateAsync(
  expr: Expr,
  getSource: (ref: string) => Promise<LocalSelector<Source>>,
  stack: readonly LocalSelector<Source>[][]
): Promise<LocalSelector<Source>> {
  // TODO: amount of evaluates should be limited?
  if (stack.length > MAX_STACK_SIZE) {
    throw new EvalError(
      `Stack overflow. Final frames: ${stack
        .slice(-10)
        .map((frame, i) =>
          frame.map((s, j) => `@[${i},${j}]: ${JSON.stringify(s)}`).join(", ")
        )
        .join(" -> ")}`,
      expr
    );
  }
  if (expr instanceof Call) {
    if (expr.children[0] instanceof Sym) {
      if (expr.children[0].value === "val") {
        if (expr.isAnon) {
          throw new EvalError("cannot call 'val' as anonymous function", expr);
        }
        if (expr.children[1] instanceof StringLiteral) {
          return getSource(expr.children[1].value);
        } else {
          throw new EvalError(
            "argument of 'val' must be a string literal",
            expr
          );
        }
      } else if (expr.children[0].value === "json") {
        if (expr.children.length !== 2) {
          throw new EvalError(
            "must call 'json' with exactly one argument",
            expr
          );
        }
        const value = await evaluateAsync(expr.children[1], getSource, stack);

        const valObj = value[SourceOrExpr];
        const valPath = value[Path];
        if (typeof valObj !== "string") {
          throw new EvalError(
            `cannot parse JSON: ${JSON.stringify(valObj)}, expected string`,
            expr.children[1]
          );
        }
        try {
          const serialized = JSON.parse(valObj);
          if (isSerializedVal(serialized)) {
            return newSelectorProxy(serialized.val, serialized.valPath);
          }
          const parsedValue = newSelectorProxy(JSON.parse(valObj), valPath);
          return parsedValue;
        } catch (e) {
          if (e instanceof SyntaxError) {
            throw new EvalError(
              `cannot parse JSON: ${valObj}, ${
                e.message
              } - value: ${JSON.stringify(value)}`,
              expr.children[1]
            );
          }
          throw e;
        }
      } else if (expr.children[0].value === "stringify") {
        // TODO: remove stringify
        if (expr.children.length !== 2) {
          throw new EvalError(
            "must call 'stringify' with exactly one argument",
            expr
          );
        }
        const res = await evaluateAsync(expr.children[1], getSource, stack);
        return newSelectorProxy(JSON.stringify(res[SourceOrExpr]));
      }
    }
    const prop = (await evaluateAsync(expr.children[0], getSource, stack))[
      SourceOrExpr
    ];
    if (expr.children.length === 1) {
      // TODO: return if literal only?
      return newSelectorProxy(prop);
    }
    const obj = await evaluateAsync(expr.children[1], getSource, stack);
    if (typeof prop !== "string" && typeof prop !== "number") {
      throw new EvalError(
        `cannot access ${JSON.stringify(obj)} with property ${JSON.stringify(
          prop
        )}: is not a string or number`,
        expr
      );
    }

    if (prop in obj) {
      if (expr.isAnon) {
        // anon functions:
        const maybeFunction = obj[prop];
        if (typeof maybeFunction !== "function") {
          throw new EvalError(
            `cannot access property ${JSON.stringify(prop)} of ${JSON.stringify(
              obj
            )}: required higher ordered function got ${typeof obj[prop]}`,
            expr
          );
        }
        if (expr.children[0] instanceof Sym) {
          return maybeFunction((...args: any[]) => {
            return evaluateAsync(
              expr.children[2],
              getSource,
              stack.concat([args])
            );
          });
        } else {
          throw new EvalError(
            `cannot call an expression that is not a symbol, got: '${expr.children[0].type}'`,
            expr
          );
        }
      } else {
        // non-anon functions:
        if (expr.children[0] instanceof Sym) {
          if (expr.children[0].value === "val") {
            if (expr.children[1] instanceof StringLiteral) {
              return getSource(expr.children[1].value);
            } else {
              throw new EvalError(
                "argument of 'val' must be a string literal",
                expr
              );
            }
          }
        }
        const args = expr.children.slice(2);
        if (args.length > 0) {
          const maybeFunction = obj[prop];
          if (typeof maybeFunction !== "function") {
            throw new EvalError(
              `cannot access property ${JSON.stringify(
                prop
              )} of ${JSON.stringify(obj)}: required function got ${typeof obj[
                prop
              ]}`,
              expr
            );
          }
          return maybeFunction(
            ...args.map((arg) => evaluateAsync(arg, getSource, stack))
          );
        }
        const maybeValue = obj[prop];
        if (typeof maybeValue === "function") {
          throw new EvalError(
            `cannot access property ${JSON.stringify(prop)} of ${JSON.stringify(
              obj
            )}: required value got ${typeof obj[prop]}`,
            expr
          );
        }
        return maybeValue;
      }
    }
  } else if (expr instanceof Sym) {
    if (expr.value.startsWith("@")) {
      const [i, j, rest] = expr.value.slice(2, -1).split(",");
      if (rest) {
        throw new EvalError(`cannot access stack: too many indices`, expr);
      }
      const stackValue = stack[Number(i)]?.[Number(j)];
      if (stackValue === undefined) {
        throw new EvalError(`cannot access stack: out of bounds`, expr);
      }
      return stackValue;
    } else if (expr.value === "()") {
      return newSelectorProxy(null);
    }
    return newSelectorProxy(expr.value);
  } else if (expr instanceof StringLiteral) {
    return newSelectorProxy(expr.value);
  } else if (expr instanceof StringTemplate) {
    return newSelectorProxy(
      await Promise.all(
        expr.children
          .map(async (child) => {
            if (child instanceof Sym && child.value === "()") {
              return "null";
            }
            const evalRes = await evaluateAsync(child, getSource, stack);
            if (
              child.type === "StringLiteral" ||
              child.type === "StringTemplate"
            ) {
              return evalRes[SourceOrExpr];
            }
            if (Path in evalRes) {
              // a selector, so serialize to Val
              return JSON.stringify({
                val: evalRes[SourceOrExpr],
                valPath: evalRes[Path],
              });
            }
            return JSON.stringify(evalRes[SourceOrExpr]);
          })
          .join("")
      )
    );
  }
  throw new EvalError(`could not evaluate`, expr);
}

export async function evaluate(
  expr: Expr,
  source: (ref: string) => Promise<LocalSelector<Source>>,
  stack: readonly LocalSelector<Source>[][]
): Promise<result.Result<LocalSelector<Source>, EvalError>> {
  try {
    return result.ok(await evaluateAsync(expr, source, stack));
  } catch (err) {
    if (err instanceof EvalError) {
      return result.err(err);
    }
    throw err;
  }
}
