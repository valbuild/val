type Token =
  | {
      type: "text";
      raw: string;
    }
  | {
      type: "space";
      amount: number;
      raw: string;
    }
  | {
      type: "tab";
      amount: number;
      raw: string;
    }
  | {
      type: "new_line";
      amount: number;
      raw: string;
    }
  | {
      type: "heading_marker";
      amount: number;
      raw: string;
    }
  | { type: "bullet_list_marker"; raw: string }
  | {
      type: "ordered_list_marker";
      raw: string;
    }
  | { type: "bold_marker"; amount: number; raw: string }
  | {
      type: "<br/>";
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
  // new lines:
  "\n",
  // spaces:
  " ",
  "\t",
  // bullet list markers:
  "-",
  // ordered list markers:
  "1",
  "2",
  "3",
  "4",
  "5",
  "6",
  "7",
  "8",
  "9",
  // ordered list separator:
  ".",
];
export function lexer(input: string): {
  tokens: Token[];
  errors: {
    pos: number;
    message: string;
  }[];
} {
  // char is really a grapheme?
  function slurpWhile(cursor: number, char: string): [number, string] {
    let amount = 1;
    while (input[cursor + amount] === char && cursor + amount < input.length) {
      amount += 1;
    }
    return [amount, input.slice(cursor, cursor + amount)];
  }
  function slurp(
    cursor: number,
    stopChars: [string, ...string[]]
  ): [number, string] {
    let amount = 0;
    while (
      !stopChars.includes(input[cursor + amount]) &&
      cursor + amount < input.length
    ) {
      amount += 1;
    }
    return [amount, input.slice(cursor, cursor + amount)];
  }

  const tokens: Token[] = [];
  for (let cursor = 0; cursor < input.length; cursor++) {
    const char = input[cursor];
    if (char === "\\" && input[cursor + 1] === "\\") {
      cursor += 1;
      tokens.push({ type: "text", raw: "\\" });
    } else if (char === "\\") {
      cursor += 1;
    } else if (char === " ") {
      // should be slurpWhile(cursor + 1) and amount should start with 0 in slurpWhile then we do not need to subtract?
      const [amount, raw] = slurpWhile(cursor, " ");
      cursor += amount - 1;
      tokens.push({
        type: "space",
        amount,
        raw,
      });
    } else if (char === "\t") {
      const [amount, raw] = slurpWhile(cursor, "\t");
      cursor += amount - 1;
      tokens.push({
        type: "tab",
        amount,
        raw,
      });
    } else if (char === "\n") {
      const [amount, raw] = slurpWhile(cursor, "\n");
      cursor += amount - 1;
      tokens.push({
        type: "new_line",
        amount,
        raw,
      });
    } else if (char === "#") {
      const [amount, raw] = slurpWhile(cursor, "#");
      cursor += amount - 1;
      tokens.push({
        type: "heading_marker",
        amount,
        raw,
      });
    } else {
      let amount = 0;
      while (
        !stopChars.includes(input[cursor + amount]) &&
        cursor + amount < input.length
      ) {
        amount += 1;
      }
      tokens.push({ type: "text", raw: input.slice(cursor, cursor + amount) });
      cursor += amount - 1;
    }
  }

  return { tokens, errors: [] };
}
