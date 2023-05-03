/* eslint-disable @typescript-eslint/no-explicit-any */
import { Call, Expr, StringLiteral, StringTemplate, Sym } from "./expr";
import { Source } from "../selector";
import { result } from "../../fp";

export class EvalError {
  constructor(public readonly message: string, public readonly expr: Expr) {}

  toString() {
    return `${this.message} in: ${this.expr.serialize()}`;
  }
}

const MAX_STACK_SIZE = 100; // an arbitrary semi-large number
function evaluateSync(
  expr: Expr,
  source: (ref: string) => Source,
  stack: Source[][]
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
      } else if (expr.children[0].value === "andThen") {
        if (!expr.isAnon) {
          throw new EvalError(
            "must call 'andThen' as anonymous function",
            expr
          );
        }
        if (expr.children.length !== 3) {
          throw new EvalError(
            "must call 'andThen' with exactly two arguments",
            expr
          );
        }

        const obj = evaluateSync(expr.children[1], source, stack);
        if (obj) {
          return evaluateSync(expr.children[2], source, stack.concat([obj]));
        }
        return obj;
      }
    }
    const prop = evaluateSync(expr.children[0], source, stack);
    if (expr.children.length === 1) {
      // TODO: return if literal only?
      return prop;
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
      return undefined;
    }
    return expr.value;
  } else if (expr instanceof StringLiteral) {
    return expr.value;
  } else if (expr instanceof StringTemplate) {
    return expr.children
      .map((child) => evaluateSync(child, source, stack))
      .join("");
  }
  throw new EvalError(`could not evaluate`, expr);
}

export function evaluate(
  expr: Expr,
  source: (ref: string) => Source,
  stack: Source[][]
): result.Result<Source, EvalError> {
  try {
    return result.ok(evaluateSync(expr, source, stack)); // TODO: make sure we return Source
  } catch (err) {
    if (err instanceof EvalError) {
      return result.err(err);
    }
    throw err;
  }
}
