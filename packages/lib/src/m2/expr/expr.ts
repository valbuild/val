/* eslint-disable @typescript-eslint/no-unused-vars */

export abstract class Expr {
  abstract type: string;
  abstract serialize(): string;
  constructor(public readonly span?: [number, number?]) {}
}

export class StringLiteral extends Expr {
  public type = "StringLiteral";
  constructor(
    public readonly value: string,
    span?: [start: number, stop: number]
  ) {
    super(span);
  }

  serialize() {
    return `'${this.value}'`;
  }
}

export class Sym extends Expr {
  public type = "Sym";
  constructor(
    public readonly value: string,
    span?: [start: number, stop: number]
  ) {
    super(span);
  }

  serialize() {
    return this.value;
  }
}

export class StringTemplate extends Expr {
  public type = "StringTemplate";
  constructor(
    public readonly children: readonly Expr[],
    span?: [number, number]
  ) {
    super(span);
  }

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

export class Call extends Expr {
  public type = "Call";
  constructor(
    public readonly children: readonly Expr[],
    public readonly isAnon: boolean,
    span?: [number, number]
  ) {
    super(span);
  }

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
