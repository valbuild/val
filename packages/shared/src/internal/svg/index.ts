export {
  parseSvg,
  type ParseSvgOptions,
  type ParseSvgResult,
  type SvgColorOverride,
  type SvgDroppedAttr,
  type SvgUnmatchedColor,
} from "./parseSvg";
export {
  svgToString,
  svgSourceToJson,
  stripSvgValPath,
  svgVariablesOf,
  type SvgToStringOptions,
} from "./svgToString";
export { colorDistance, normalizeColor, parseColor, type Rgb } from "./colors";
export {
  parseXml,
  decodeXmlEntities,
  encodeXmlText,
  type XmlElement,
  type XmlParseResult,
} from "./xml";
