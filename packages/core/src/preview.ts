import { Schema } from "./schema";
import { ImageMetadata } from "./schema/image";
import { SelectorSource } from "./selector";
import { ImageSource } from "./source/image";
import { RemoteSource } from "./source/remote";
import { ModuleFilePath, SourcePath } from "./val";

export type ListRecordPreview = {
  layout: "list";
  parent: "record";
  items: [
    key: string,
    value: {
      title: string;
      subtitle?: string | null;
      image?: ImageSource | RemoteSource<ImageMetadata> | null;
    },
  ][];
};

export type ListArrayPreview = {
  layout: "list";
  parent: "array";
  items: {
    title: string;
    subtitle?: string | null;
    image?: ImageSource | RemoteSource<ImageMetadata> | null;
  }[];
};

// Main preview type:
type PreviewTypes = ListRecordPreview | ListArrayPreview;
//

type WithStatus<T> =
  | {
      status: "error";
      message: string;
    }
  | {
      // TODO: loading doesn't really belong in core - however this is used in other places where it does make sense and we figured... Why not just add it here?
      status: "loading";
      data?: T;
    }
  | {
      status: "success";
      data: T;
    };
export type ReifiedPreview = Record<
  SourcePath | ModuleFilePath,
  WithStatus<PreviewTypes>
>;

// TODO: improve this so that we do not get RawString and string, only string. Are there other things?
export type PreviewSelector<T extends Schema<SelectorSource>> =
  T extends Schema<infer S> ? S : never;
