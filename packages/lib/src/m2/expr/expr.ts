/* eslint-disable @typescript-eslint/no-unused-vars */

interface Serializable {
  serialize(): string;
  span: [start: number, stop: number];
}

interface Literal extends Serializable {
  type: string;
}

class StringLiteral implements Literal {
  public type = "string";

  constructor(
    public readonly value: string,
    public readonly span: [start: number, stop: number]
  ) {}
  serialize() {
    return `"${escapeString(this.value)}"`;
  }
}

class Sym implements Serializable {
  constructor(
    public value: string,
    public readonly span: [start: number, stop: number]
  ) {}

  serialize() {
    return this.value;
  }
}

type SExpr = Fn | Literal | Sym;

export class Fn implements Serializable {
  constructor(
    public readonly children: readonly SExpr[],
    public readonly span: [number, number]
  ) {}

  serialize(): string {
    return `(${this.children.map((child) => child.serialize()).join(" ")}`;
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
