/* eslint-disable @typescript-eslint/no-unused-vars */

export interface Expr {
  type: string;
  serialize(): string;
  span: [start: number, stop: number];
}

export class StringLiteral implements Expr {
  public type = "StringLiteral";
  constructor(
    public readonly value: string,
    public readonly span: [start: number, stop: number]
  ) {}

  serialize() {
    return `'${this.value}'`;
  }
}

export class Sym implements Expr {
  public type = "Sym";
  constructor(
    public readonly value: string,
    public readonly span: [start: number, stop: number]
  ) {}

  serialize() {
    return this.value;
  }
}

export class StringTemplate implements Expr {
  public type = "StringTemplate";
  constructor(
    public readonly children: readonly Expr[],
    public readonly span: [number, number]
  ) {}

  serialize() {
    return `'${this.children
      .map((child) => {
        if (child instanceof StringLiteral) {
          return child.value;
        } else {
          return `\${${child.serialize()}}`;
        }
      })
      .join("")}'`;
  }
}

export class Call implements Expr {
  public type = "Call";
  constructor(
    public readonly children: readonly Expr[],
    public readonly span: [number, number],
    public readonly isAnon: boolean
  ) {}

  serialize() {
    if (this.isAnon) {
      return `!(${this.children.map((child) => child.serialize()).join(" ")})`;
    }
    return `(${this.children.map((child) => child.serialize()).join(" ")})`;
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

// TODO: use this instead of including the unescaped strings in the parser
function escapeString(str: string) {
  return str.replace(/\\/g, "\\\\");
}
