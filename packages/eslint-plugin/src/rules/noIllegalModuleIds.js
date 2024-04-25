// @ts-check
import path from "path";
import fs from "fs";

/**
 * @type {Record<string, string>}
 */
const PACKAGE_JSON_DIRS_CACHE = {}; // we cache to avoid having to do as many fs operations. however, it will fail if the user moves package.json / root directories. For now, we accept that bug since performance is considered more important. Maybe there is a way to know when that happens so we avoid those bugs.

/**
 * @type {import('eslint').Rule.RuleModule}
 */
export default {
  meta: {
    type: "problem",
    docs: {
      description:
        "Check that the first argument of export default declaration matches the string from val.config.{j,t}s file.",
      recommended: true,
    },
    fixable: "code",
    schema: [],
  },
  create: function (context) {
    return {
      ExportDefaultDeclaration(node) {
        /**
         * @type {string | undefined}
         */
        let expectedValue;
        if (node.parent.type === "Program") {
          const maybeValConfigImportDeclaration = node.parent.body.find((n) =>
            n.type === "ImportDeclaration" &&
            typeof n.source.value === "string" &&
            (n.source.value.endsWith("val.config") ||
              n.source.value.endsWith("val.config.ts") ||
              n.source.value.endsWith("val.config.js"))
              ? n.source.value
              : false
          );
          if (
            maybeValConfigImportDeclaration?.type === "ImportDeclaration" &&
            typeof maybeValConfigImportDeclaration.source.value === "string"
          ) {
            const filename = context.filename || context.getFilename();
            if (
              filename?.endsWith(".val.ts") ||
              filename?.endsWith(".val.js")
            ) {
              let packageJsonDir =
                PACKAGE_JSON_DIRS_CACHE[path.dirname(filename)];
              if (!packageJsonDir) {
                const runtimeRoot = path.resolve(context.cwd || process.cwd());
                packageJsonDir = path.resolve(path.dirname(filename));
                while (
                  !fs.existsSync(path.join(packageJsonDir, "package.json")) &&
                  packageJsonDir !== runtimeRoot
                ) {
                  packageJsonDir = path.dirname(packageJsonDir);
                }
                PACKAGE_JSON_DIRS_CACHE[path.dirname(filename)] =
                  packageJsonDir;
              }
              const relativePath = path.relative(packageJsonDir, filename);
              expectedValue = `/${relativePath.replace(/\.val\.(ts|js)$/, "")}`;
            }
          }
        } else {
          console.warn("Unexpected parent type", node.parent.type);
        }
        if (!expectedValue) {
          return;
        }
        if (
          node.declaration &&
          node.declaration.type === "CallExpression" &&
          node.declaration.arguments &&
          node.declaration.arguments.length > 0
        ) {
          const firstArg = node.declaration.arguments[0];
          if (firstArg.type === "TemplateLiteral") {
            context.report({
              node: firstArg,
              message: "Val: c.define id should not be a template literal",
              fix: (fixer) => fixer.replaceText(firstArg, `"${expectedValue}"`),
            });
          }
          if (
            firstArg.type === "Literal" &&
            typeof firstArg.value === "string"
          ) {
            if (firstArg.value !== expectedValue) {
              const rawArg = firstArg.raw?.[0];
              if (rawArg) {
                context.report({
                  node: firstArg,
                  message: `Val: c.define id should match the filename. Expected: '${expectedValue}'. Found: '${firstArg.value}'`,
                  fix: (fixer) =>
                    fixer.replaceText(
                      firstArg,
                      `${rawArg}${expectedValue}${rawArg}`
                    ),
                });
              }
            }
          }
        }
      },
    };
  },
};
