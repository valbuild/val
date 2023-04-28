import { Call, Expr, StringLiteral, StringTemplate, Sym } from "./expr";
import { Source } from "../selector";
import { result } from "../../fp";

export class EvalError {
  constructor(public readonly message: string) {}
}
export function evaluate(
  expr: Expr,
  source: (ref: string) => Source
): result.Result<any, EvalError> {
  console.log("evaluate", expr.serialize());
  if (expr instanceof Call) {
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
    const propRes = evaluate(expr.children[0], source);
    const objRes = evaluate(expr.children[1], source);
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
            ...args.map((arg) => evaluate(arg, source).value!)
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
  } else if (expr instanceof Sym) {
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
