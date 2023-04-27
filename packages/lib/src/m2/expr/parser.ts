import { tokenize } from "./tokenizer";

export class ParserError {
  constructor(
    public readonly message: string,
    public readonly span: [number, number]
  ) {}
}

export function parse(input: string) {
  // TODO: tokenize(input);
}
