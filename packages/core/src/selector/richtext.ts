import { GenericSelector } from ".";
import { RichText, RichTextOptions } from "../source/richtext";

export type RichTextSelector<O extends RichTextOptions> = GenericSelector<{
  options: O;
}> &
  RichText<O>;
