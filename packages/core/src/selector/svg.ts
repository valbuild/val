import { SvgOptions, SvgSource } from "../source/svg";
import { GenericSelector } from ".";

// NOTE: as with RichText, we do not (yet) support selecting sub-nodes of an svg.
// This exists so that every Source type has a corresponding Selector type.
export type SvgSelector<O extends SvgOptions> = GenericSelector<SvgSource<O>>;
