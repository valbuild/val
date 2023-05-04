import { result } from "../../fp";
import { Call, Expr, StringLiteral, StringTemplate, Sym } from "./expr";
import { Token, tokenize } from "./tokenizer";

export class ParserError {
  constructor(
    public readonly message: string,
    public readonly span?: [number, number?]
  ) {}
}

function parseTokens(inputTokens: Token[]): result.Result<Expr, ParserError> {
  const tokens = inputTokens.slice();

  function slurpCall(
    first: Token,
    isAnon: boolean
  ): result.Result<Call | Sym, ParserError> {
    // peek
    if (
      (tokens[0]?.type === "ws" && tokens[1]?.type === ")") ||
      tokens[0]?.type === ")"
    ) {
      slurpWs();
      tokens.shift();
      return result.ok(new Sym("()", [first.span[0], first.span[1] + 1]));
    }
    const args: Expr[] = [];
    let completed = false;
    while (!completed) {
      const res = slurp();
      if (result.isOk(res)) {
        args.push(res.value);
        completed =
          tokens[0]?.type !== "ws" ||
          (tokens[0]?.type === "ws" && tokens[1]?.type === ")");
      } else {
        return res;
      }
    }
    if (tokens[0]?.type === "ws" && tokens[1]?.type === ")") {
      tokens.shift();
    }
    const last = tokens.shift();
    if (last?.type !== ")") {
      return result.err(
        new ParserError("unbalanced parens: missing a ')'", [
          first.span[0],
          first.span[1] + 1,
        ])
      );
    }
    return result.ok(
      new Call(args, isAnon, [first.span[0], args.slice(-1)[0].span?.[1]])
    );
  }

  function slurpWs() {
    while (tokens[0]?.type === "ws") {
      tokens.shift();
    }
  }

  function slurpTemplate(
    first: Token
  ): result.Result<StringLiteral | StringTemplate, ParserError> {
    const children: Expr[] = [];
    while (tokens.length > 0) {
      if ((tokens[0]?.type as string) === "'") {
        break;
      }
      const nextToken = tokens.shift();
      if (nextToken?.type === "${") {
        const res = slurp();
        if (result.isOk(res)) {
          children.push(res.value);
          const last = tokens.shift();
          if (!last) {
            return result.err(
              new ParserError("unbalanced string template: missing a '}'", [
                first.span[0],
                children.slice(-1)[0].span?.[1],
              ])
            );
          } else if (last.type !== "}") {
            return result.err(
              new ParserError(
                "unbalanced string template: expected '}'",
                last.span
              )
            );
          }
        } else {
          return res;
        }
      } else if (nextToken?.type === "string") {
        children.push(
          new StringLiteral(
            nextToken.unescapedValue || nextToken.value || "",
            nextToken.span
          )
        );
      }
    }

    const last = tokens.shift();
    if (!last) {
      return result.err(
        new ParserError("unbalanced string template: missing a '''", [
          first.span[0],
          children.slice(-1)[0].span?.[1],
        ])
      );
    } else if (last.type !== "'") {
      return result.err(
        new ParserError("unbalanced string template: expected '''", last.span)
      );
    }

    return result.ok(
      new StringTemplate(children, [first.span[0], last.span[1]])
    );
  }

  function slurpString(
    first: Token
  ): result.Result<StringLiteral | StringTemplate, ParserError> {
    if (tokens[0]?.type === "string" && tokens[1]?.type === "'") {
      const stringToken = tokens.shift();
      const last = tokens.shift();
      if (!last || !stringToken) {
        throw Error("Unexpected error: stringToken or last is undefined");
      }
      return result.ok(
        new StringLiteral(
          stringToken.unescapedValue || stringToken.value || "",
          [first.span[0], last.span[1]]
        )
      );
    } else if (tokens[0]?.type === "'") {
      const last = tokens.shift();
      if (!last) {
        throw Error("Unexpected error: last is undefined");
      }
      return result.ok(new StringLiteral("", [first.span[0], last.span[1]]));
    } else {
      return slurpTemplate(first);
    }
  }

  function slurp(): result.Result<Expr, ParserError> {
    slurpWs();
    const first = tokens.shift();
    if (!first) {
      return result.err(
        new ParserError("expected '(', '!(', string or literal", [0, 0])
      );
    }
    if (first.type === "(" || first.type === "!(") {
      return slurpCall(first, first.type === "!(");
    } else if (first.type === "'") {
      return slurpString(first);
    } else if (first.type === "token") {
      if (first.value?.includes("(") || first.value?.includes(")")) {
        return result.err(
          new ParserError(
            "unexpected token: '(' and ')' are not allowed in tokens",
            first.span
          )
        );
      }
      if (first.value?.includes("'")) {
        return result.err(
          new ParserError(
            'unexpected token: "\'" is not allowed in tokens',
            first.span
          )
        );
      }
      if (first.value?.includes(".")) {
        return result.err(
          new ParserError(
            'unexpected token: "." is not allowed in tokens',
            first.span
          )
        );
      }
      if (first.value?.includes("{") || first.value?.includes("}")) {
        return result.err(
          new ParserError(
            "unexpected token: '{' and '}' are not allowed in tokens",
            first.span
          )
        );
      }
      return result.ok(new Sym(first.value || "", first.span));
    } else {
      return result.err(
        new ParserError(
          `expected '(', '!(' or literal or token${
            first.value || first.type
              ? `, got: '${first.value || first.type}'`
              : ""
          }`,
          first.span
        )
      );
    }
  }
  const res = slurp();
  slurpWs();
  if (result.isErr(res)) {
    return res;
  }
  if (tokens.length > 0) {
    return result.err(
      new ParserError("expected end of input, superfluous tokens", [
        tokens[0].span[0],
        tokens.slice(-1)[0].span[1],
      ])
    );
  }
  return res;
}
export function parse(input: string): result.Result<Expr, ParserError> {
  const [tokens, cursor] = tokenize(input); // TODO: we can use cursor to improve error messages / spans
  return parseTokens(tokens);
}
