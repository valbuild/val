import { ImageSource } from "./source/image";
import { ModuleFilePath, SourcePath } from "./val";

export type ListRecordPreview = {
  layout: "list";
  items: [
    key: string,
    value: {
      title: string;
      subtitle?: string | null;
      image?: ImageSource | null;
    },
  ][];
};
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
type PreviewTypes = ListRecordPreview;
export type ReifiedPreview = Record<
  SourcePath | ModuleFilePath,
  WithStatus<PreviewTypes>
>;
