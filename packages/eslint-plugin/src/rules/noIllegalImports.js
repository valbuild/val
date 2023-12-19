// @ts-check
import path from "path";

/**
 * @type {import('eslint').Rule.RuleModule}
 */
export default {
  meta: {
    type: "problem",
    docs: {
      description: "Check that val files only has valid imports.",
      category: "Best Practices",
      recommended: true,
    },
    fixable: "code",
    schema: [],
  },
  create: function (context) {
    return {
      ImportDeclaration(node) {
        const importSource = node.source.value;
        const filename = context.filename || context.getFilename();

        const isValFile =
          filename.endsWith(".val.ts") || filename.endsWith(".val.js");
        // only allow: .val files, @valbuild packages, and val config
        if (
          isValFile &&
          typeof importSource === "string" &&
          !importSource.match(/\.val(\.ts|\.js|)$/) &&
          !importSource.match(/^@valbuild/) &&
          !importSource.match(/val\.config(\.ts|\.js|)$/)
        ) {
          const message = `Val: import source should be a .val.ts file, a @valbuild package, or val.config.ts. Found: '${importSource}'`;
          context.report({
            node: node.source,
            message,
          });
        }
      },
    };
  },
};
