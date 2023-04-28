import { Call, Expr, StringLiteral, StringTemplate, Sym } from "./expr";
import { Source } from "../selector";
import { result } from "../../fp";

export class EvalError {
  constructor(public readonly message: string) {}
}
export function evaluate(
  expr: Expr,
  source: (ref: string) => Source,
  stack: Source[][]
): any {
  if (expr instanceof Call) {
    if (expr.isAnon) {
      if (expr.children[0] instanceof Sym) {
        const propRes = evaluate(expr.children[0], source, stack);
        const objRes = evaluate(expr.children[1], source, stack);
        const x = objRes.value[propRes.value!]((...args) => {
          return evaluate(expr.children[2], source, stack.concat([args]))
            .value!;
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
      if (typeof obj !== "object") {
        return result.err(
          new EvalError(
            `cannot get property ${
              propRes.value
            } from non-object ${JSON.stringify(objRes.value)}`
          )
        );
      }
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
      if (!(prop in obj)) {
        return result.err(
          new EvalError(
            `property ${propRes.value} not found in object ${JSON.stringify(
              objRes.value
            )}`
          )
        );
      }
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
