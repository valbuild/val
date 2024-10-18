/* eslint-disable @typescript-eslint/ban-types */
import { Source } from "../source";
import { FileMetadata } from "../source/file";
import { Selector as UnknownSelector, GenericSelector } from "./index";

// TODO: docs
export type FileSelector<Metadata extends FileMetadata | undefined> =
  GenericSelector<{
    url: string;
  }> & {
    readonly url: UnknownSelector<string>;
  } & Metadata extends undefined
    ? {}
    : Metadata extends Source
      ? { readonly metadata: UnknownSelector<Metadata> }
      : {};
