import j from "jscodeshift";
import * as prettier from "prettier/standalone";
import * as estreePlugin from "prettier/plugins/estree";
import * as typescriptPlugin from "prettier/plugins/typescript";

export async function transformNextAppRouterValProvider(
  fileInfo: j.FileInfo,
  api: j.API,
  options: j.Options,
): Promise<string> {
  if (!options.configImportPath) {
    throw new Error("configImportPath is required");
  }
  const root = api.jscodeshift(fileInfo.source);
  root
    .find(j.ImportDeclaration)
    .at(0)
    .insertBefore(
      j.importDeclaration(
        [j.importSpecifier(j.identifier("ValProvider"))],
        j.literal("@valbuild/next"),
      ),
    )
    .insertBefore(
      j.importDeclaration(
        [
          j.importSpecifier(j.identifier("config")),
          j.importSpecifier(j.identifier("isValEnabled")),
        ],
        j.literal(options.configImportPath),
      ),
    );
  // `await isValEnabled()` requires the default export to be async.
  root.find(j.ExportDefaultDeclaration).forEach((path) => {
    const decl = path.value.declaration;
    if (
      decl.type === "FunctionDeclaration" ||
      decl.type === "FunctionExpression" ||
      decl.type === "ArrowFunctionExpression"
    ) {
      decl.async = true;
    }
  });
  root
    .findJSXElements("body")
    .childNodes()
    .forEach((el) => {
      if (el.value.type === "JSXExpressionContainer") {
        if (
          el.value.expression.type === "Identifier" &&
          el.value.expression.name === "children"
        ) {
          el.replace(
            j.jsxElement(
              {
                name: {
                  type: "JSXIdentifier",
                  name: "ValProvider",
                },
                type: "JSXOpeningElement",
                selfClosing: false,
                attributes: [
                  {
                    type: "JSXAttribute",
                    name: {
                      type: "JSXIdentifier",
                      name: "config",
                    },
                    value: {
                      type: "JSXExpressionContainer",
                      expression: {
                        type: "Identifier",
                        name: "config",
                      },
                    },
                  },
                  {
                    type: "JSXAttribute",
                    name: {
                      type: "JSXIdentifier",
                      name: "suspend",
                    },
                    value: {
                      type: "JSXExpressionContainer",
                      expression: j.awaitExpression(
                        j.callExpression(j.identifier("isValEnabled"), []),
                      ),
                    },
                  },
                ],
              },
              {
                name: {
                  type: "JSXIdentifier",
                  name: "ValProvider",
                },
                type: "JSXClosingElement",
              },
              [j.jsxExpressionContainer(j.identifier("children"))],
            ),
          );
        }
      }
    });
  // jscodeshift's recast re-prints any node we mutate (e.g. toggling `async`)
  // with its default formatting, which loses the original indentation. Run
  // prettier so the patch we hand back to the user is consistently formatted
  // regardless of which nodes were touched.
  // Use prettier/standalone (rather than the main prettier entry) so this
  // codemod runs under jest's Node VM, which doesn't support prettier 3's
  // dynamic plugin imports without --experimental-vm-modules.
  return prettier.format(root.toSource(), {
    parser: "typescript",
    plugins: [estreePlugin, typescriptPlugin],
  });
}
