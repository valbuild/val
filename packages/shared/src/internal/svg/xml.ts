/**
 * A minimal, dependency free XML reader, scoped to what an exported svg
 * contains.
 *
 * We hand roll rather than take a dependency because `@valbuild/shared` ships
 * into every Val user's server bundle and svg-as-xml is a small grammar: no
 * optional end tags, no implicit closing, no raw text elements. `DOMParser` is
 * deliberately not used - it does not exist in node or QuickJS, and two
 * implementations would be two divergence surfaces.
 *
 * This reader is *not* a security boundary. Its output is filtered against the
 * allowlist in `@valbuild/core` before anything else looks at it.
 */

export type XmlElement = {
  tag: string;
  attrs: Record<string, string>;
  children: XmlElement[];
};

export type XmlParseResult =
  | { status: "success"; root: XmlElement }
  | { status: "error"; message: string };

const ENTITIES: Readonly<Record<string, string>> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
};

/**
 * `String.fromCodePoint` THROWS a RangeError on anything outside 0..0x10FFFF,
 * and `&#1114112;` / `&#x7FFFFFFF;` parse to finite numbers that are outside it.
 * Since this runs on imported svg markup, an unguarded call turns a malformed
 * entity into a crash in the middle of parsing. Leave an out-of-range entity as
 * written instead: the surrounding validation reports the markup, the parser
 * does not die on it.
 */
function codePointToString(code: number, match: string): string {
  if (!Number.isInteger(code) || code < 0 || code > 0x10ffff) {
    return match;
  }
  return String.fromCodePoint(code);
}

export function decodeXmlEntities(input: string): string {
  return input.replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z]+);/g, (match, body) => {
    // Lowercase `x` only, per the XML CharRef production - which is also all the
    // regex above can match, so `&#X43;` is left as written.
    if (body.startsWith("#x")) {
      return codePointToString(parseInt(body.slice(2), 16), match);
    }
    if (body.startsWith("#")) {
      return codePointToString(parseInt(body.slice(1), 10), match);
    }
    const named = ENTITIES[body as keyof typeof ENTITIES];
    return named === undefined ? match : named;
  });
}

export function encodeXmlText(input: string): string {
  return input
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/**
 * Parses xml and returns the single root element.
 *
 * Rejects entity declarations and doctypes with an internal subset outright:
 * those are the XXE / billion-laughs vectors, and a parser that silently
 * ignores them is worse than no parser at all.
 */
export function parseXml(input: string): XmlParseResult {
  if (/<!ENTITY/i.test(input)) {
    return {
      status: "error",
      message: "Entity declarations are not allowed",
    };
  }
  let i = 0;
  const src = input;
  const stack: XmlElement[] = [];
  let root: XmlElement | null = null;

  const error = (message: string): XmlParseResult => ({
    status: "error",
    message,
  });

  while (i < src.length) {
    const lt = src.indexOf("<", i);
    if (lt === -1) {
      break;
    }
    i = lt;
    if (src.startsWith("<!--", i)) {
      const end = src.indexOf("-->", i + 4);
      if (end === -1) {
        return error("Unterminated comment");
      }
      i = end + 3;
      continue;
    }
    if (src.startsWith("<![CDATA[", i)) {
      const end = src.indexOf("]]>", i + 9);
      if (end === -1) {
        return error("Unterminated CDATA section");
      }
      i = end + 3;
      continue;
    }
    if (src.startsWith("<?", i)) {
      const end = src.indexOf("?>", i + 2);
      if (end === -1) {
        return error("Unterminated processing instruction");
      }
      i = end + 2;
      continue;
    }
    if (src.startsWith("<!", i)) {
      // <!DOCTYPE ...>. An internal subset ('[' before '>') is rejected.
      const gt = src.indexOf(">", i + 2);
      const bracket = src.indexOf("[", i + 2);
      if (gt === -1) {
        return error("Unterminated declaration");
      }
      if (bracket !== -1 && bracket < gt) {
        return error("Doctype with an internal subset is not allowed");
      }
      i = gt + 1;
      continue;
    }
    if (src.startsWith("</", i)) {
      const gt = src.indexOf(">", i + 2);
      if (gt === -1) {
        return error("Unterminated closing tag");
      }
      const tag = src.slice(i + 2, gt).trim();
      const open = stack.pop();
      if (!open) {
        return error(`Unexpected closing tag '${tag}'`);
      }
      if (open.tag !== tag) {
        return error(
          `Mismatched closing tag: expected '${open.tag}', got '${tag}'`,
        );
      }
      i = gt + 1;
      continue;
    }

    // Opening tag. Scan to '>' while respecting quoted attribute values.
    let j = i + 1;
    let quote: string | null = null;
    while (j < src.length) {
      const ch = src[j];
      if (quote) {
        if (ch === quote) {
          quote = null;
        }
      } else if (ch === '"' || ch === "'") {
        quote = ch;
      } else if (ch === ">") {
        break;
      }
      j++;
    }
    if (j >= src.length) {
      return error("Unterminated tag");
    }
    let body = src.slice(i + 1, j);
    const selfClosing = body.trimEnd().endsWith("/");
    if (selfClosing) {
      body = body.trimEnd().slice(0, -1);
    }
    const nameMatch = /^([^\s/>]+)/.exec(body);
    if (!nameMatch) {
      return error("Malformed tag");
    }
    const tag = nameMatch[1];
    const attrs: Record<string, string> = {};
    const attrSrc = body.slice(nameMatch[1].length);
    const attrRe = /([^\s=/]+)\s*(?:=\s*("([^"]*)"|'([^']*)'|([^\s"'>]+)))?/g;
    let attrMatch: RegExpExecArray | null;
    while ((attrMatch = attrRe.exec(attrSrc)) !== null) {
      const name = attrMatch[1];
      if (!name) {
        continue;
      }
      const raw = attrMatch[3] ?? attrMatch[4] ?? attrMatch[5] ?? "";
      // Later duplicates lose, matching how browsers read xml attributes.
      if (!(name in attrs)) {
        attrs[name] = decodeXmlEntities(raw);
      }
    }
    const element: XmlElement = { tag, attrs, children: [] };
    const parent = stack[stack.length - 1];
    if (parent) {
      parent.children.push(element);
    } else if (root) {
      return error("Expected a single root element");
    } else {
      root = element;
    }
    if (!selfClosing) {
      stack.push(element);
    }
    i = j + 1;
  }

  if (stack.length > 0) {
    return error(`Unclosed tag '${stack[stack.length - 1].tag}'`);
  }
  if (!root) {
    return error("No element found");
  }
  return { status: "success", root };
}
