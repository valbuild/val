import { Schema } from "./schema";
import { ImageMetadata } from "./schema/image";
import { SelectorSource } from "./selector";
import { ImageSource } from "./source/image";
import { RemoteSource } from "./source/remote";
import { ModuleFilePath, SourcePath } from "./val";

export type ListRecordRender = {
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

export type ListArrayRender = {
  layout: "list";
  parent: "array";
  items: {
    title: string;
    subtitle?: string | null;
    image?: ImageSource | RemoteSource<ImageMetadata> | null;
  }[];
};

// Main render type:
type RenderTypes = ListRecordRender | ListArrayRender;
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
export type ReifiedRender = Record<
  SourcePath | ModuleFilePath,
  WithStatus<RenderTypes>
>;

// TODO: improve this so that we do not get RawString and string, only string. Are there other things?
export type RenderSelector<T extends Schema<SelectorSource>> =
  T extends Schema<infer S> ? S : never;
