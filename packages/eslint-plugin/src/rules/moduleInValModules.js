// @ts-check
import fs from "fs";
import path from "path";
import ts from "typescript";

/** @type {Record<string, ts.ModuleResolutionCache>} */
const cache = {};
/**
 * @type {import('eslint').Rule.RuleModule}
 */
export default {
  meta: {
    type: "problem",
    docs: {
      description:
        "Ensure all .val files with export default c.define are referenced in val.modules",
      recommended: true,
    },
    schema: [], // No options needed
    messages: {
      missingFile:
        "'{{file}}' contains export default c.define but is not referenced in val.modules.ts or val.module.js.",
    },
  },
  create(context) {
    const projectDir = path.resolve(context.cwd || context.getCwd());
    const modulesFilePath = path.join(projectDir, "val.modules.ts");

    let baseUrl = projectDir;
    /** @type { {[key: string]: string[];} } */
    let paths = {};
    let cacheKey = baseUrl;

    const tsConfigPath = ts.findConfigFile(
      projectDir,
      ts.sys.fileExists,
      "tsconfig.json",
    );
    const jsConfigPath = ts.findConfigFile(
      projectDir,
      ts.sys.fileExists,
      "jsconfig.json",
    );

    if (tsConfigPath) {
      const tsConfig = tsConfigPath
        ? JSON.parse(fs.readFileSync(tsConfigPath, "utf-8"))
        : {};

      baseUrl = tsConfig.compilerOptions?.baseUrl
        ? path.resolve(projectDir, tsConfig.compilerOptions.baseUrl)
        : projectDir;
      paths = tsConfig.compilerOptions?.paths || {};
      cacheKey = baseUrl + "/tsconfig.json";
      if (!cache[cacheKey]) {
        cache[cacheKey] = ts.createModuleResolutionCache(
          baseUrl,
          (x) => x,
          tsConfig.compilerOptions,
        );
      }
    } else if (jsConfigPath) {
      const jsConfig = jsConfigPath
        ? JSON.parse(fs.readFileSync(jsConfigPath, "utf-8"))
        : {};

      baseUrl = jsConfig.compilerOptions?.baseUrl
        ? path.resolve(projectDir, jsConfig.compilerOptions.baseUrl)
        : projectDir;
      paths = jsConfig.compilerOptions?.paths || {};
      cacheKey = baseUrl + "/jsconfig.json";
      if (!cache[cacheKey]) {
        cache[cacheKey] = ts.createModuleResolutionCache(
          baseUrl,
          (x) => x,
          jsConfig.compilerOptions,
        );
      }
    }

    // Function to resolve import paths
    const resolvePath = (/** @type {string} */ importPath) => {
      // Attempt to resolve using TypeScript path mapping
      const resolvedModule = ts.resolveModuleName(
        importPath,
        path.join(baseUrl, "val.modules.ts"),
        {
          baseUrl,
          paths,
        },
        ts.sys,
        cache[cacheKey],
      );
      const resolved = resolvedModule.resolvedModule?.resolvedFileName;
      if (resolved) {
        return path.resolve(resolved);
      }
      // Fallback to Node.js resolution
      try {
        return require.resolve(importPath, { paths: [projectDir] });
      } catch {
        return undefined;
      }
    };

    if (!fs.existsSync(modulesFilePath)) {
      return {};
    }

    const modulesFileContent = fs.readFileSync(modulesFilePath, "utf-8");
    const referencedFiles = Array.from(
      modulesFileContent.matchAll(/import\(["'](.+\.val(?:\.[jt]s)?)['"]\)/g),
    )
      .map((match) => {
        return resolvePath(match[1]);
      })
      .filter((file) => file !== undefined);

    return {
      ExportDefaultDeclaration(node) {
        const filename = context.filename || context.getFilename();
        if (filename?.includes(".val")) {
          if (
            node.declaration &&
            node.declaration.type === "CallExpression" &&
            node.declaration.callee.type === "MemberExpression" &&
            node.declaration.callee.object.type === "Identifier" &&
            node.declaration.callee.object.name === "c" &&
            node.declaration.callee.property.type === "Identifier" &&
            node.declaration.callee.property.name === "define" &&
            node.declaration.arguments &&
            node.declaration.arguments.length > 0
          ) {
            if (!referencedFiles.includes(filename)) {
              context.report({
                node,
                messageId: "missingFile",
                data: { file: filename.replace(projectDir, "") },
              });
            }
          }
        }
      },
    };
  },
};
