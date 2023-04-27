export type Token = {
  readonly type:
    | "!("
    | "("
    | ")"
    | "string"
    | "token"
    | "ws"
    | "${"
    | "}"
    | "'";
  readonly span: [start: number, stop: number]; // inclusive start, inclusive stop
  readonly value?: string;
  readonly unescapedValue?: string;
};

export function tokenize(input: string): [tokens: Token[], endCursor: number] {
  const tokens: Token[] = [];
  let cursor = 0;
  while (cursor < input.length) {
    let char = input[cursor];
    let peek = input[cursor + 1];
    // TODO: remove this not used any more
    if (char === "!" && peek === "(") {
      tokens.push({ type: "!(", span: [cursor, cursor + 1] });
      cursor += 2;
    } else if (char === "(") {
      tokens.push({ type: "(", span: [cursor, cursor] });
      cursor++;
    } else if (char === ")") {
      tokens.push({ type: ")", span: [cursor, cursor] });
      cursor++;
    } else if (char === "'" || char === "}") {
      const start = cursor;
      let value = "";
      let unescapedValue = "";
      let escaped = false;
      if (char === "}") {
        tokens.push({ type: "}", span: [cursor, cursor] });
      } else if (char === "'") {
        tokens.push({ type: "'", span: [cursor, cursor] });
      }
      while (cursor < input.length) {
        if (char === "\\") {
          escaped = !escaped;
        } else {
          escaped = false;
        }
        if (peek === "'" && !escaped) {
          cursor += 2;
          break;
        } else if (char === "$" && peek === "{") {
          cursor += 2;
          break;
        }
        cursor++;
        char = input[cursor];
        peek = input[cursor + 1];
        if (!(char === "$" && peek === "{") && cursor < input.length) {
          if (
            !(
              (char === "\\" && !escaped) // counter-intuitive, but escape just became false if this was a backslash we want to escape
            )
          ) {
            value += char;
          }
          unescapedValue += char;
        }
      }
      const cursorOffset =
        peek === "'" && !escaped ? 2 : char === "$" && peek === "{" ? 3 : 1;
      if (value) {
        tokens.push({
          type: "string",
          span: [start + 1, cursor - cursorOffset],
          value,
          ...(unescapedValue !== value && { unescapedValue }),
        });
      }
      if (peek === "'" && !escaped) {
        tokens.push({ type: "'", span: [cursor - 1, cursor - 1] });
      } else if (char === "$" && peek === "{") {
        tokens.push({
          type: "${",
          span: [cursor - cursorOffset + 1, cursor - 1],
        });
      }
    } else if (char === " ") {
      const start = cursor;
      while (input[cursor] === " " && cursor < input.length) {
        cursor++;
      }
      tokens.push({ type: "ws", span: [start, cursor - 1] });
    } else {
      let value = "";
      const start = cursor;
      do {
        char = input[cursor];
        peek = input[cursor + 1];
        value += char;
        cursor++;
      } while (
        peek !== " " &&
        peek !== ")" &&
        peek !== "'" &&
        cursor < input.length
      );
      tokens.push({
        type: "token",
        span: [start, cursor - 1],
        value,
      });
    }
  }
  return [tokens, cursor];
}
