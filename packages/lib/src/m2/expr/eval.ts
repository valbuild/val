/* eslint-disable @typescript-eslint/no-explicit-any */
import { Call, Expr, StringLiteral, StringTemplate, Sym } from "./expr";
import { Source } from "../Source";
import { result } from "../../fp";
import { SelectorC, VAL_OR_EXPR } from "../selector";
import { newSelectorProxy } from "../selector/SelectorProxy";

export class EvalError {
  constructor(public readonly message: string, public readonly expr: Expr) {}

  toString() {
    return `${this.message} in: ${this.expr.transpile()}`;
  }
}

const MAX_STACK_SIZE = 100; // an arbitrary semi-large number
function evaluateSync(
  expr: Expr,
  source: (ref: string) => SelectorC<Source>,
  stack: readonly SelectorC<Source>[][]
): any {
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
          return source(expr.children[1].value);
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
        const value = evaluateSync(expr.children[1], source, stack);
        const valOrExpr = value[VAL_OR_EXPR]();
        try {
          const parsedValue = newSelectorProxy(
            JSON.parse(valOrExpr.val),
            valOrExpr.valPath
          );
          return parsedValue;
        } catch (e) {
          if (e instanceof SyntaxError) {
            throw new EvalError(
              `cannot parse JSON: ${valOrExpr.val}, ${
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
        const res = evaluateSync(expr.children[1], source, stack);
        return newSelectorProxy(JSON.stringify(res[VAL_OR_EXPR]()));
      }
    }
    const prop = evaluateSync(expr.children[0], source, stack)[VAL_OR_EXPR]()
      .val;
    if (expr.children.length === 1) {
      // TODO: return if literal only?
      return newSelectorProxy(prop);
    }
    const obj = evaluateSync(expr.children[1], source, stack);
    if (typeof prop !== "string" && typeof prop !== "number") {
      throw new EvalError(
        `cannot access ${JSON.stringify(obj)} with property ${JSON.stringify(
          prop
        )}: is not a string or number`,
        expr
      );
    }
    if (expr.isAnon) {
      // anon functions:
      if (typeof obj[prop] !== "function") {
        throw new EvalError(
          `cannot access property ${JSON.stringify(prop)} of ${JSON.stringify(
            obj
          )}: required function got ${typeof obj[prop]}`,
          expr
        );
      }
      if (expr.children[0] instanceof Sym) {
        return obj[prop]((...args: any[]) => {
          return evaluateSync(expr.children[2], source, stack.concat([args]));
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
            return source(expr.children[1].value);
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
        if (typeof obj[prop] !== "function") {
          throw new EvalError(
            `cannot access property ${JSON.stringify(prop)} of ${JSON.stringify(
              obj
            )}: required function got ${typeof obj[prop]}`,
            expr
          );
        }
        return obj[prop](
          ...args.map((arg) => evaluateSync(arg, source, stack))
        );
      }
      return obj[prop];
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
      return newSelectorProxy(undefined);
    }
    return newSelectorProxy(expr.value);
  } else if (expr instanceof StringLiteral) {
    return newSelectorProxy(expr.value);
  } else if (expr instanceof StringTemplate) {
    return newSelectorProxy(
      expr.children
        .map((child) => {
          if (
            child.type === "StringLiteral" ||
            child.type === "StringTemplate"
          ) {
            return evaluateSync(child, source, stack)[VAL_OR_EXPR]().val;
          } else if (child instanceof Sym && child.value === "()") {
            return "null";
          }
          return JSON.stringify(
            evaluateSync(child, source, stack)[VAL_OR_EXPR]()
          );
        })
        .join("")
    );
  }
  throw new EvalError(`could not evaluate`, expr);
}

export function evaluate(
  expr: Expr,
  source: (ref: string) => SelectorC<Source>,
  stack: readonly SelectorC<Source>[][]
): result.Result<SelectorC<Source>, EvalError> {
  try {
    return result.ok(evaluateSync(expr, source, stack));
  } catch (err) {
    if (err instanceof EvalError) {
      return result.err(err);
    }
    throw err;
  }
}
