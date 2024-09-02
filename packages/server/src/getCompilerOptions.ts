import path from "path";
import ts from "typescript";

export const getCompilerOptions = (
  rootDir: string,
  parseConfigHost: ts.ParseConfigHost,
): ts.CompilerOptions => {
  const tsConfigPath = path.resolve(rootDir, "tsconfig.json");
  const jsConfigPath = path.resolve(rootDir, "jsconfig.json");
  let configFilePath: string;
  if (parseConfigHost.fileExists(jsConfigPath)) {
    configFilePath = jsConfigPath;
  } else if (parseConfigHost.fileExists(tsConfigPath)) {
    configFilePath = tsConfigPath;
  } else {
    throw Error(
      `Could not read config from: "${tsConfigPath}" nor "${jsConfigPath}". Root dir: "${rootDir}"`,
    );
  }
  const { config, error } = ts.readConfigFile(
    configFilePath,
    parseConfigHost.readFile.bind(parseConfigHost),
  );
  if (error) {
    if (typeof error.messageText === "string") {
      throw Error(
        `Could not parse config file: ${configFilePath}. Error: ${error.messageText}`,
      );
    }
    throw Error(
      `Could not parse config file: ${configFilePath}. Error: ${error.messageText.messageText}`,
    );
  }
  const optionsOverrides = undefined;
  const parsedConfigFile = ts.parseJsonConfigFileContent(
    config,
    parseConfigHost,
    rootDir,
    optionsOverrides,
    configFilePath,
  );
  if (parsedConfigFile.errors.length > 0) {
    throw Error(
      `Could not parse config file: ${configFilePath}. Errors: ${parsedConfigFile.errors
        .map((e) => e.messageText)
        .join("\n")}`,
    );
  }
  return parsedConfigFile.options;
};
