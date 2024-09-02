/* eslint-disable @typescript-eslint/no-unused-vars */

export abstract class Expr {
  abstract type: "StringLiteral" | "Sym" | "StringTemplate" | "Call";
  abstract transpile(): string;
  constructor(public readonly span?: [number, number?]) {}
}

export class StringLiteral extends Expr {
  public type = "StringLiteral" as const;
  constructor(
    public readonly value: string,
    span?: [start: number, stop: number],
  ) {
    super(span);
  }

  transpile() {
    return `'${this.value}'`;
  }
}

export class Sym extends Expr {
  public type = "Sym" as const;
  constructor(
    public readonly value: string,
    span?: [start: number, stop: number],
  ) {
    super(span);
  }

  transpile() {
    return this.value;
  }
}

export const NilSym = new Sym("()");

export class StringTemplate extends Expr {
  public type = "StringTemplate" as const;
  constructor(
    public readonly children: readonly Expr[],
    span?: [number, number],
  ) {
    super(span);
  }

  transpile() {
    return `'${this.children
      .map((child) => {
        if (child instanceof StringLiteral) {
          return child.value;
        } else {
          return `\${${child.transpile()}}`;
        }
      })
      .join("")}'`;
  }
}

export class Call extends Expr {
  public type = "Call" as const;
  constructor(
    public readonly children: readonly Expr[],
    public readonly isAnon: boolean,
    span?: [number, number],
  ) {
    super(span);
  }

  transpile() {
    if (this.isAnon) {
      return `!(${this.children.map((child) => child.transpile()).join(" ")})`;
    }
    return `(${this.children.map((child) => child.transpile()).join(" ")})`;
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
