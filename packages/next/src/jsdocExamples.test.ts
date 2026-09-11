import * as path from "path";
import * as ts from "typescript";

/**
 * Every member of what `initVal()` hands back carries an `@example`, and the
 * editor shows it on hover.
 *
 * The same check `@valbuild/core` runs over `s` (see
 * `packages/core/src/schema/jsdocExamples.test.ts`, which also compiles the
 * examples it finds), narrowed to what THIS package adds on top: `isValEnabled`, the routers, and the extra `val` helpers. It
 * goes through the type checker rather than grepping for `@example`, because
 * what a developer sees is the doc TypeScript resolves for the symbol - which
 * for an intersection like `val` is spread over two declarations.
 *
 * Presence only, unlike core's: these examples read content with `useVal`, and
 * `useVal` comes from the app's OWN `val/client.ts` (what `initValClient`
 * returns), which does not exist in this package. There is nothing here to
 * compile them against.
 */

const PROBE = path.join(__dirname, "__jsdocExamplesProbe__.ts");
const PROBE_SOURCE = `
import { initVal } from "./initVal";

export const valSystem = initVal();
export const valHelpers = valSystem.val;
`;

const COMPILER_OPTIONS: ts.CompilerOptions = {
  target: ts.ScriptTarget.ES2020,
  module: ts.ModuleKind.ESNext,
  moduleResolution: ts.ModuleResolutionKind.Bundler,
  strict: true,
  skipLibCheck: true,
  noEmit: true,
  jsx: ts.JsxEmit.ReactJSX,
};

const host = ts.createCompilerHost(COMPILER_OPTIONS, true);
const readFile = host.readFile.bind(host);
const fileExists = host.fileExists.bind(host);
const getSourceFile = host.getSourceFile.bind(host);
host.readFile = (fileName) =>
  fileName === PROBE ? PROBE_SOURCE : readFile(fileName);
host.fileExists = (fileName) =>
  fileName === PROBE ? true : fileExists(fileName);
host.getSourceFile = (fileName, languageVersion, ...rest) =>
  fileName === PROBE
    ? ts.createSourceFile(fileName, PROBE_SOURCE, languageVersion, true)
    : getSourceFile(fileName, languageVersion, ...rest);

const program = ts.createProgram([PROBE], COMPILER_OPTIONS, host);
const checker = program.getTypeChecker();
const probeFile = program.getSourceFile(PROBE);
if (!probeFile) {
  throw new Error("Could not create the probe source file");
}

function exportedType(name: string): ts.Type {
  const moduleSymbol = checker.getSymbolAtLocation(probeFile as ts.SourceFile);
  if (!moduleSymbol) {
    throw new Error("The probe is not a module");
  }
  const symbol = checker
    .getExportsOfModule(moduleSymbol)
    .find((exported) => exported.getName() === name);
  if (!symbol || !symbol.valueDeclaration) {
    throw new Error(`The probe does not export '${name}'`);
  }
  return checker.getTypeOfSymbolAtLocation(symbol, symbol.valueDeclaration);
}

function membersWithoutExample(label: string, type: ts.Type): string[] {
  const members = type.getProperties().filter((symbol) => {
    const declaration = symbol.declarations?.[0];
    if (!declaration) {
      return false;
    }
    const modifiers = ts.getCombinedModifierFlags(declaration);
    if (modifiers & (ts.ModifierFlags.Private | ts.ModifierFlags.Protected)) {
      return false;
    }
    return (
      ts.isPropertySignature(declaration) ||
      ts.isMethodSignature(declaration) ||
      ts.isMethodDeclaration(declaration)
    );
  });
  if (members.length === 0) {
    throw new Error(`No members found on '${label}' - the probe is wrong`);
  }
  return members
    .filter(
      (member) =>
        member.getJsDocTags(checker).filter((tag) => tag.name === "example")
          .length === 0,
    )
    .map((member) => `${label}.${member.getName()}`);
}

describe("initVal JSDoc examples", () => {
  test("the probe type checks", () => {
    // Without this, a probe that failed to compile would hand the tests below
    // an `any` with no members, and they would pass having checked nothing.
    const errors = program
      .getSemanticDiagnostics(probeFile)
      .concat(program.getSyntacticDiagnostics(probeFile))
      .map((diagnostic) =>
        ts.flattenDiagnosticMessageText(diagnostic.messageText, " "),
      );
    expect(errors).toEqual([]);
  });

  test("every member of initVal() has an example", () => {
    expect(
      membersWithoutExample("initVal()", exportedType("valSystem")),
    ).toEqual([]);
  });

  test("every helper on `val` has an example", () => {
    expect(membersWithoutExample("val", exportedType("valHelpers"))).toEqual(
      [],
    );
  });
});
