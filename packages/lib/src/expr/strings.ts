import { Expr, parse } from "./expr";

/**
 * Like {@link String.prototype.lastIndexOf}, but with respect to expression
 * syntax.
 *
 * The search will ignore the contents of string literals and only return a match
 * if the match is at the same nesting level as the starting character. During
 * traversal, it will assert that there are no mismatched parens or square
 * brackets.
 *
 * @param str The string to search in.
 * @param searchString The substring to search for.
 * @param position The index at which to begin searching. If omitted, the search
 * begins at the end of the string.
 */
export function lastIndexOf(
  str: string,
  searchString: string,
  position = str.length - 1
): number {
  if (searchString.length !== 1)
    throw Error("searchString must be single character");
  let stringExpr = false;
  const stack: (")" | "]")[] = [];
  for (let i = position; i >= 0; --i) {
    const char = str[i];
    switch (char) {
      case `"`:
        if (stringExpr) {
          if (str[i - 1] !== "\\") {
            stringExpr = false;
          }
        } else {
          stringExpr = true;
        }
        break;
      case ")":
      case "]":
        stack.push(char);
        break;
      case "(":
        if (stack.pop() !== ")") {
          throw Error("Invalid parens");
        }
        break;
      case "[":
        if (stack.pop() !== "]") {
          throw Error("Invalid square brackets");
        }
        break;
    }
    if (
      !stringExpr &&
      stack.length === 0 &&
      str.slice(i, i + searchString.length) === searchString
    ) {
      return i;
    }
  }
  return -1;
}

/**
 * Like {@link String.prototype.indexOf}, but with respect to expression
 * syntax.
 *
 * The search will ignore the contents of string literals and only return a match
 * if the match is at the same nesting level as the starting character. During
 * traversal, it will assert that there are no mismatched parens or square
 * brackets.
 *
 * @param str The string to search in.
 * @param searchString The substring to search for.
 * @param position The index at which to begin searching the String object. If
 * omitted, search starts at the beginning of the string.
 */
export function indexOf(
  str: string,
  searchString: string,
  position = 0
): number {
  let stringExpr = false;
  const stack: ("(" | "[")[] = [];
  for (let i = position; i < str.length; ++i) {
    const char = str[i];
    switch (char) {
      case `"`:
        if (stringExpr) {
          if (str[i - 1] !== "\\") {
            stringExpr = false;
          }
        } else {
          stringExpr = true;
        }
        break;
      case "(":
      case "[":
        stack.push(char);
        break;
      case ")":
        if (stack.pop() !== "(") {
          throw Error("Invalid parens");
        }
        break;
      case "]":
        if (stack.pop() !== "[") {
          throw Error("Invalid square brackets");
        }
        break;
    }
    if (
      !stringExpr &&
      stack.length === 0 &&
      str.slice(i, i + searchString.length) === searchString
    ) {
      return i;
    }
  }
  return -1;
}

/**
 * Like {@link String.prototype.split}, but with respect to expression
 * syntax.
 *
 * The split will ignore the contents of string literals and only split if the
 * separator occurs at the same nesting level as the starting character. It will
 * also assert that there are no mismatched parens or square brackets.
 *
 * @param str The string to split.
 * @param separator A string that identifies character or characters to use in
 * separating the string.
 */
export function split(str: string, separator: string) {
  const res: string[] = [];
  let currentIndex = 0;
  while (currentIndex !== -1) {
    const needleIndex = indexOf(str, separator, currentIndex);
    if (needleIndex === -1) {
      res.push(str.slice(currentIndex));
      currentIndex = -1;
    } else {
      res.push(str.slice(currentIndex, needleIndex));
      currentIndex = needleIndex + separator.length;
    }
  }
  return res;
}

export function encodeValSrc(
  moduleId: string,
  locale: "en_US",
  expr: Expr<readonly [never], unknown>
): string {
  return `${moduleId}?${locale}?${expr.toString([""])}`;
}

export function parseValSrc(
  source: string
): [
  moduleId: string,
  locale: "en_US",
  sourceExpr: Expr<readonly [never], unknown>
] {
  const [moduleId, locale, exprStr] = split(source, "?");
  const sourceExpr = parse<readonly [unknown]>({ "": 0 }, exprStr);
  return [moduleId, locale as "en_US", sourceExpr];
}
