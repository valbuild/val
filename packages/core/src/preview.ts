import { ImageSource } from "./source/image";

export type CardRecordPreview = {
  renderType: "card";
  schemaType: "record";
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
export type ReifiedPreview = WithStatus<
  | CardRecordPreview
  | {
      renderType: "auto";
      schemaType: "object" | "record";
      items: Record<string, ReifiedPreview> | null;
    }
  | {
      renderType: "auto";
      schemaType: "array";
      items: ReifiedPreview[] | null;
    }
  | {
      renderType: "auto";
      schemaType: "scalar";
    }
  | null
>;
