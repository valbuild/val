/* eslint-disable @typescript-eslint/no-unused-vars */

export interface Expr {
  serialize(): string;
  span: [start: number, stop: number];
}

export class StringLiteral implements Expr {
  constructor(
    public readonly value: string,
    public readonly span: [start: number, stop: number]
  ) {}

  serialize() {
    return `'${this.value}'`;
  }
}

export class Sym implements Expr {
  constructor(
    public readonly value: string,
    public readonly span: [start: number, stop: number]
  ) {}

  serialize() {
    return this.value;
  }
}

export class StringTemplate implements Expr {
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
  constructor(
    public readonly children: readonly Expr[],
    public readonly span: [number, number]
  ) {}

  serialize() {
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

function escapeString(str: string) {
  return str.replace(/\\/g, "\\\\");
}
