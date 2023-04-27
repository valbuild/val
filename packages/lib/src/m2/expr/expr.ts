/* eslint-disable @typescript-eslint/no-unused-vars */

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

export class SExpr implements Serializable {
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

// export function interpret(
//   expr: SExpr,
//   moduleId: string,
//   schemas: {
//     [moduleId: string]: Schema<Source>;
//   },
//   getSource: (moduleId: string) => Promise<Source>
// ) {}

function escapeString(str: string) {
  return str.replace(/'/g, "\\'");
}
