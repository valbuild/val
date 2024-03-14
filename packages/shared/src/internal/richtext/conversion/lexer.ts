// NOTE: we do added fields with ?: undefined to avoid casting while parsing. Could be removed, but currently I think this makes it less cumbersome to work with the tokens. You / future me might
export type Token =
  | {
      type: "text";
      amount?: undefined;
      raw: string;
    }
  | {
      type: "space";
      amount: number;
      raw?: undefined;
    }
  | {
      type: "\t" | "\n" | "#" | "*" | "_" | "-" | "~";
      amount: number;
      raw?: undefined;
    }
  | {
      type: "(1-9).";
      amount?: undefined;
      raw: string;
    }
  | {
      type: "<br/>";
      amount?: undefined;
      raw: string;
    };
const stopChars = [
  // escape:
  "\\",
  // heading
  "#",
  // bold:
  "*",
  // italic:
  "_",
  // line-through:
  "~",
  // new lines:
  "\n",
  // spaces:
  " ",
  // TODO: fold tabs into 4 spaces?
  // tabs:
  "\t",
  // start: <br/>
  "<",
  // bullet list markers:
  // TODO: support more bullet list markers: * and +
  "-",
  // ordered list markers (1., 2., 3., ...) handled in logic below
  // TODO: support 1. and 1)
];
export function lexer(input: string): {
  tokens: Token[];
  errors: {
    pos: number;
    message: string;
  }[];
} {
  // char OR grapheme? char is more accurate (?), but less clear tho?
  function slurpWhile(cursor: number, char: string): [number] {
    let amount = 0;
    while (input[cursor + amount] === char && cursor + amount < input.length) {
      amount += 1;
    }
    return [amount];
  }

  const tokens: Token[] = [];
  let cursor = 0;
  while (cursor < input.length) {
    const char = input[cursor];
    if (char === "\\" && input[cursor + 1] === "\\") {
      cursor += 1;
      const prevToken = tokens[tokens.length - 1];
      if (prevToken?.type === "text") {
        prevToken.raw += "\\";
      } else {
        tokens.push({ type: "text", raw: "\\" });
      }
    } else if (char === "\\") {
      cursor += 1;
    } else if (
      char === " " ||
      char === "\t" ||
      char === "\n" ||
      char === "*" ||
      char === "-" ||
      char === "_" ||
      char === "~" ||
      char === "#"
    ) {
      const [slurpAmount] = slurpWhile(cursor, char);
      const type = char === " " ? "space" : char;
      const prevToken = tokens[tokens.length - 1];
      if (prevToken?.type === type) {
        prevToken.amount += slurpAmount;
      } else {
        tokens.push({
          type,
          amount: slurpAmount,
        });
      }
      cursor += slurpAmount;
    } else if (
      ((char === "1" ||
        char === "2" ||
        char === "3" ||
        char === "4" ||
        char === "5" ||
        char === "6" ||
        char === "7" ||
        char === "8" ||
        char === "9") &&
        input[cursor + 1] === ".") ||
      input[cursor + 1] === ")"
    ) {
      tokens.push({
        type: `(1-9).`,
        raw: char + input[cursor + 1],
      });
      cursor += 2;
    } else if (char === "<") {
      let amount = 1;
      // a bit more code than necessary, but it's more readable?
      while (input[amount + cursor] === " ") {
        amount += 1;
      }
      if (
        input[amount + cursor] === "b" &&
        input[amount + cursor + 1] === "r"
      ) {
        amount += 2;
      }
      while (input[amount + cursor] === " ") {
        amount += 1;
      }
      if (input[amount + cursor] === "/") {
        amount += 1;
      }
      while (input[amount + cursor] === " ") {
        amount += 1;
      }
      if (input[amount + cursor] === ">") {
        amount += 1;
      }
      if (amount > 1) {
        tokens.push({
          type: "<br/>",
          raw: input.slice(cursor, cursor + amount),
        });
        cursor += amount;
      } else {
        const prevToken = tokens[tokens.length - 1];
        if (prevToken?.type === "text") {
          prevToken.raw += input[cursor];
        } else {
          tokens.push({
            type: "text",
            raw: input[cursor],
          });
        }
        cursor += 1;
      }
    } else {
      let amount = 1;
      while (
        !(
          stopChars.includes(input[cursor + amount]) ||
          ((char === "1" ||
            char === "2" ||
            char === "3" ||
            char === "4" ||
            char === "5" ||
            char === "6" ||
            char === "7" ||
            char === "8" ||
            char === "9") &&
            input[cursor + amount + 1] === ".") ||
          input[cursor + amount + 1] === ")"
        ) &&
        cursor + amount < input.length
      ) {
        amount += 1;
      }
      const prevToken = tokens[tokens.length - 1];
      if (prevToken?.type === "text") {
        prevToken.raw += input.slice(cursor, cursor + amount);
      } else {
        tokens.push({
          type: "text",
          raw: input.slice(cursor, cursor + amount),
        });
      }
      cursor += amount;
    }
  }

  return { tokens, errors: [] };
}
