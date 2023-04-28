import { Call, Expr, StringLiteral, StringTemplate, Sym } from "./expr";
import { Source } from "../selector";
import { result } from "../../fp";

export class EvalError {
  constructor(public readonly message: string) {}
}
const MAX_STACK_SIZE = 100; // an arbitrary semi-large number
export function evaluate(
  expr: Expr,
  source: (ref: string) => Source,
  stack: Source[][]
): any {
  // TODO: amount of evaluates should be limited?
  if (stack.length > MAX_STACK_SIZE) {
    return result.err(
      new EvalError(
        `Stack overflow. Expr: "${expr.serialize()}". Final frames: ${stack
          .slice(-10)
          .map((frame, i) =>
            frame.map((s, j) => `@[${i},${j}]: ${JSON.stringify(s)}`).join(", ")
          )
          .join(" -> ")}`
      )
    );
  }
  // console.log(expr?.serialize(), stack);
  if (expr instanceof Call) {
    if (expr.isAnon) {
      if (expr.children[0] instanceof Sym) {
        const propRes = evaluate(expr.children[0], source, stack);
        const objRes = evaluate(expr.children[1], source, stack);
        const x = objRes.value[propRes.value!]((...args) => {
          const res = evaluate(expr.children[2], source, stack.concat([args]));
          if (result.isErr(res)) {
            throw res.error;
          }
          return res.value!;
        });
        return result.ok(x);
      } else {
        return result.err(
          new EvalError(
            `Cannot call non-symbol '${
              expr.children[0].type
            }' in: ${expr.children[0].serialize()}`
          )
        );
      }
    } else {
      if (expr.children[0] instanceof Sym) {
        if (expr.children[0].value === "val") {
          if (expr.children[1] instanceof StringLiteral) {
            return result.ok(source(expr.children[1].value));
          } else {
            return result.err(
              new EvalError("argument of 'val' must be a string literal")
            );
          }
        }
      }
      const propRes = evaluate(expr.children[0], source, stack);
      const objRes = evaluate(expr.children[1], source, stack);
      if (result.isErr(propRes)) {
        return propRes;
      } else if (result.isErr(objRes)) {
        return objRes;
      }
      const obj = objRes.value as Record<string | number, Source>;
      // TODO: we cannot do this on strings, should do more dynamic type checking
      // if (typeof obj !== "object") {
      //   return result.err(
      //     new EvalError(
      //       `cannot get property ${
      //         propRes.value
      //       } from non-object ${JSON.stringify(objRes.value)}`
      //     )
      //   );
      // }
      const prop = propRes.value;
      if (typeof prop !== "string" && typeof prop !== "number") {
        return result.err(
          new EvalError(
            `cannot access ${JSON.stringify(
              objRes.value
            )} with property ${JSON.stringify(prop)}: is not a string or number`
          )
        );
      }
      // TODO: cannot do this on string, same as above, more dynamic type checking
      // if (!(prop in obj)) {
      //   return result.err(
      //     new EvalError(
      //       `property ${propRes.value} not found in object ${JSON.stringify(
      //         objRes.value
      //       )}`
      //     )
      //   );
      // }
      const args = expr.children.slice(2);
      if (args.length > 0) {
        try {
          return result.ok(
            obj[prop](
              ...args.map((arg) => evaluate(arg, source, stack).value!)
            ) as Source
          ); // TODO: make sure we return Source
        } catch (err) {
          console.error(err);
          return result.err(
            new EvalError(`could not evaluate children ${JSON.stringify(expr)}`)
          );
        }
      }
      return result.ok(obj[prop]);
    }
  } else if (expr instanceof Sym) {
    // TODO: fix this in the
    if (expr.value.startsWith("@")) {
      const [a, b] = expr.value.slice(2, -1).split(",");
      // TODO: this is ugly
      return result.ok(stack[a][b]);
    }
    return result.ok(expr.value!); // TODO: check
  } else if (expr instanceof StringLiteral) {
    return result.ok(expr.value!);
  } else if (expr instanceof StringTemplate) {
    throw new Error("not implemented");
  }
  return result.err(
    new EvalError(`could not evaluate ${JSON.stringify(expr, null, 2)}`)
  );
}
