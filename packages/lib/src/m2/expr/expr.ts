/* eslint-disable @typescript-eslint/no-unused-vars */
import { Schema } from "../schema";
import { Source } from "../selector";

interface Serializable {
  serialize(): string;
}

interface Literal extends Serializable {
  type: string;
}

class SymbolLiteral implements Literal {
  public type = ":";

  constructor(public value: string | number) {}

  serialize() {
    if (typeof this.value === "number") {
      return `:${this.value}`;
    }
    return `:"${escapeString(this.value)}"`;
  }
}

class ArgumentLiteral implements Literal {
  public type = "@"; // equivalent to clojure %

  constructor(public argNumber: number) {
    if (argNumber < 0) {
      throw new Error("Argument number must be positive");
    }
  }

  serialize() {
    if (this.argNumber === 0) {
      return "@";
    }

    return `@${this.argNumber}`;
  }
}

class StringLiteral implements Literal {
  public type = "string";

  constructor(public value: string) {}

  serialize() {
    return `"${escapeString(this.value)}"`;
  }
}

class NumberLiteral implements Literal {
  public type = "number";

  constructor(public value: number) {}
  serialize() {
    return `${this.value}`;
  }
}

class BooleanLiteral implements Literal {
  public type = "boolean";

  constructor(public value: boolean) {}

  serialize() {
    return this.value ? "true" : "false";
  }
}

class UndefinedLiteral implements Literal {
  public type = "undefined"; // equivalent to clojure nil

  serialize() {
    return "undefined";
  }
}

class SetLiteral implements Literal {
  public type = "set";

  constructor(public value: [SymbolLiteral, SExpr | Literal][]) {}

  serialize() {
    return `{${this.value
      .map(([lhs, rhs]) => `(${lhs.serialize()} ${rhs.serialize()})`)
      .join(" ")}}`;
  }
}

class SForm implements Serializable {
  constructor(public readonly name: string) {}

  serialize(): string {
    return this.name;
  }
}
const AnonFnForm = new SForm("!"); // !() is equivalent to clojure #()
const MapForm = new SForm("map");
const FilterForm = new SForm("filter");
const LengthForm = new SForm("length");
const SliceForm = new SForm("slice");
const RemoteForm = new SForm("remote");
const FileForm = new SForm("file");

type Node = SExpr | SForm | Literal;

class SExpr implements Serializable {
  constructor(
    public car: Node,
    public cdr: Node,
    public span: [number, number]
  ) {}

  serialize(): string {
    if (this.car instanceof SForm && this.car.name === "!") {
      return `!(${this.car.serialize()} ${this.cdr.serialize()})`;
    }
    return `(${this.car.serialize()} ${this.cdr.serialize()})`;
  }
}

export class ParseError {
  constructor(
    public readonly message: string,
    public readonly span: [number, number]
  ) {}
}

// export function interpret(
//   expr: SExpr,
//   moduleId: string,
//   schemas: {
//     [moduleId: string]: Schema<Source>;
//   },
//   getSource: (moduleId: string) => Promise<Source>
// ) {}

export type Token = {
  readonly type: "!(" | "(" | ")" | "string" | "token" | "ws" | "${" | "}";
  readonly span: [number, number];
  readonly value?: string;
};

const RESERVED_CHARS = ["!", "(", ")", "'", ":", "@"];
export function tokenize(input: string) {
  const tokens: Token[] = [];
  let cursor = 0;
  const tokenStack: Token[][] = [];
  while (cursor < input.length) {
    let char = input[cursor];
    let peek = input[cursor + 1];
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
      let value = "";
      while (cursor < input.length) {
        if (peek === "'") {
          cursor += 2;
          break;
        } else if (char === "$" && peek === "{") {
          cursor += 2;
          break;
        }
        cursor++;
        char = input[cursor];
        peek = input[cursor + 1];
        if (!(char === "$" && peek === "{")) {
          value += char;
        }
      }
      tokens.push({
        type: "string",
        span: [cursor - value.length, cursor],
        value: value,
      });
    } else if (char === " ") {
      const start = cursor;
      while (input[cursor] === " " && cursor < input.length) {
        cursor++;
      }
      tokens.push({ type: "ws", span: [start, cursor] });
    } else {
      let value = "";
      const start = cursor;
      while (
        peek !== " " &&
        peek !== ")" &&
        peek !== "'" &&
        cursor < input.length
      ) {
        if (RESERVED_CHARS.includes(char)) {
          throw new ParseError(
            `Unexpected token: found a reserved character ${char}`,
            [start, cursor]
          );
        }
        char = input[cursor];
        peek = input[cursor + 1];
        value += char;
        cursor++;
      }
      tokens.push({
        type: "token",
        span: [start, cursor],
        value,
      });
    }
  }
  return tokens;
}

export function parse(input: string) {
  return tokenize(input);
}

function escapeString(str: string) {
  return str.replace(/'/g, "\\'");
}
