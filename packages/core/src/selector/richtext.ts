import { GenericSelector } from ".";
import { RichTextOptions, RichTextSource } from "../source/richtext";

// NOTE: We are uncertain if we want to be able to select sub-objects of RichText?
// we added this to be consistent since we need a Selector of every Source type
export type RichTextSelector<O extends RichTextOptions> = GenericSelector<
  RichTextSource<O>
>;
