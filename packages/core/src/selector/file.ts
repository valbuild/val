/* eslint-disable @typescript-eslint/ban-types */
import { Source } from "../source";
import { FileMetadata, FileSource } from "../source/file";
import { Selector as UnknownSelector, GenericSelector } from "./index";

// TODO: docs
export type FileSelector<Metadata extends FileMetadata | undefined> =
  GenericSelector<
    FileSource<Metadata> & {
      url: string;
      metadata: Metadata extends undefined ? {} : Metadata;
    }
  > &
    FileSource<Metadata> &
    Metadata extends undefined
    ? {}
    : Metadata extends Source
    ? { readonly metadata: UnknownSelector<Metadata> }
    : {};
