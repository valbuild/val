import {
  SourcePath,
  ImageSchema,
  ImageMetadata,
  FileSource,
  ImageSource,
} from "@valbuild/core";
import { NullSource } from "../components/NullSource";

export function ImageField({
  path,
  source,
  schema,
}: {
  path: SourcePath;
  source: ImageSource;
  schema: ImageSchema<FileSource<ImageMetadata> | null>;
}) {
  if (!source) {
    return <NullSource />;
  }
  return (
    <img
      src="https://plus.unsplash.com/premium_photo-1712000451123-16ab37e9ff5c?q=80&w=3089&auto=format&fit=crop&ixlib=rb-4.0.3&ixid=M3wxMjA3fDB8MHxwaG90by1wYWdlfHx8fGVufDB8fHx8fA%3D%3D"
      draggable={false}
      className="object-contain w-full max-h-[500px]"
      style={{
        cursor: "crosshair",
      }}
    />
  );
}

export function ImagePreview({ source }: { source: any }) {
  return <img src={source} />;
}
