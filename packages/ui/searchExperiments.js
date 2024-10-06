/* eslint-disable @typescript-eslint/no-var-requires */

const testData = require("./testData");
const FlexSearch = require("flexsearch");

function rec(source, schema, path, sourceIndex, sourcePathIndex) {
  const isRoot = path.endsWith("?p="); // skip root module
  if (
    !isRoot // skip root module
  ) {
    addTokenizedSourcePath(sourcePathIndex, path);
  }
  if (!schema?.type) {
    throw new Error("Schema not found for " + path);
  }
  if (source === null) {
    return;
  }
  if (schema.type === "richtext") {
    addTokenizedSourcePath(sourcePathIndex, path);
    sourceIndex.add(path, stringifyRichText(source));
    return;
  } else if (schema.type === "array") {
    for (let i = 0; i < source.length; i++) {
      const subPath = path + (isRoot ? "" : ".") + i;
      if (!schema?.item) {
        throw new Error(
          "Schema (" + schema.type + ") item not found for " + subPath
        );
      }
      rec(source[i], schema?.item, subPath, sourceIndex, sourcePathIndex);
    }
  } else if (schema.type === "object" || schema.type === "record") {
    for (const key in source) {
      const subSchema = schema?.items?.[key] || schema?.item;
      const subPath = path + (isRoot ? "" : ".") + JSON.stringify(key);

      if (!subSchema) {
        throw new Error(
          "Schema  (" + schema.type + ") item(s) not found for " + subPath
        );
      }
      rec(source[key], subSchema, subPath, sourceIndex, sourcePathIndex);
    }
  } else if (schema.type === "union") {
    if (typeof schema.key === "string") {
      const subSchema = schema.items.find(
        (item) => item.items[schema.key].value === source[schema.key]
      );
      if (!subSchema) {
        throw new Error(
          "Schema  (" + schema.type + ") item(s) not found for " + path
        );
      }
      rec(source, subSchema, path, sourceIndex, sourcePathIndex);
    }
  } else if (schema.type === "string") {
    if (typeof source !== "string") {
      throw new Error(
        "Expected string, got " + typeof source + " for " + path + ": " + source
      );
    }
    if (typeof source === "string") {
      sourceIndex.add(path, source);
    }
  } else if (schema.type === "keyOf" || schema.type === "date") {
    if (typeof source === "string") {
      sourceIndex.add(path, source);
    }
  } else if (schema.type === "number") {
    if (typeof source === "number") {
      sourceIndex.add(path, source.toString());
    }
  }
}

function stringifyRichText(source) {
  let res = "";
  function rec(child) {
    if (typeof child === "string") {
      res += child;
    } else {
      if (
        child &&
        typeof child === "object" &&
        "children" in child &&
        Array.isArray(child.children)
      ) {
        for (const c of child.children) {
          rec(c);
        }
      }
    }
  }
  rec({ children: source });
  return res;
}

function isUpperCase(char) {
  // Check if the character is a letter and if it's uppercase
  return char.toUpperCase() === char && char.toLowerCase() !== char;
}

function splitOnCase(str) {
  const result = [];
  let currentWord = "";

  for (let i = 0; i < str.length; i++) {
    const char = str[i];

    if (i !== 0 && isUpperCase(char)) {
      result.push(currentWord);
      currentWord = char;
    } else {
      currentWord += char;
    }
  }

  if (currentWord) {
    result.push(currentWord);
  }

  return result;
}

function tokenizeSourcePath(sourcePath) {
  const tokens = [sourcePath]; // add full path
  const existingTokens = new Set();
  const parts = sourcePath.split("/").slice(1); // skip first empty part
  const lastPart = parts.pop();
  for (const part of parts) {
    if (existingTokens.has(part)) {
      continue;
    }
    existingTokens.add(part);
    tokens.push(part);
    for (const casePart of splitOnCase(part)) {
      if (existingTokens.has(casePart)) {
        continue;
      }
      existingTokens.add(casePart);
      tokens.push(casePart);
    }
  }
  const [moduleFileName, modulePath] = lastPart.split("?p=");
  const fileExtLength = 7; // length of .val.[tj]s
  const filenameWithoutExt = moduleFileName.slice(0, -fileExtLength);
  tokens.push(...splitOnCase(filenameWithoutExt), filenameWithoutExt);
  if (!modulePath) {
    return tokens;
  }
  for (const part of modulePath.split(".")) {
    if (existingTokens.has(part)) {
      continue;
    }
    existingTokens.add(part);
    tokens.push(part);
    for (const casePart of splitOnCase(part)) {
      if (existingTokens.has(casePart)) {
        continue;
      }
      existingTokens.add(casePart);
      tokens.push(casePart);
    }
  }
  return tokens;
}

// console.log(
//   tokenizeSourcePath(
//     '/content/employeesTest/employeeListTest.val.ts?p="mkd"."name"'
//   ),
//   [
//     '/content/employeesTest/employeeListTest.val.ts?p="mkd"."name"',
//     "content",
//     "employeesTest",
//     "employees",
//     "Test",
//     "employee",
//     "List",
//     "Test",
//     "employeeListTest",
//     '"mkd"',
//     '"name"',
//   ]
// );

function addTokenizedSourcePath(sourcePathIndex, sourcePath) {
  sourcePathIndex.add(sourcePath, tokenizeSourcePath(sourcePath));
}

console.time("indexing");
const modules = testData;
const sourceIndices = [];
const sourcePathIndices = [];
for (const moduleFilePathS in modules) {
  const { source, schema } = modules[moduleFilePathS];

  const sourcePathIndex = new FlexSearch.Index({
    tokenize: tokenizeSourcePath,
  });
  addTokenizedSourcePath(sourcePathIndex, moduleFilePathS);
  sourcePathIndices.push(sourcePathIndex);
  const sourceIndex = new FlexSearch.Index({
    tokenize: "strict",
  });
  sourceIndices.push(sourceIndex);
  rec(source, schema, moduleFilePathS + "?p=", sourceIndex, sourcePathIndex);
}
console.timeEnd("indexing");

const query = process.argv[2];

function search(sourcePathIndices, sourceIndices, query) {
  console.time("search: " + query);
  let results = sourcePathIndices.flatMap((index) => index.search(query));
  if (results.length === 0) {
    results = sourceIndices.flatMap((index) => index.search(query));
  }
  console.timeEnd("search: " + query);
  return results;
}

console.log(search(sourcePathIndices, sourceIndices, query));
