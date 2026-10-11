---
"@valbuild/core": minor
---

New names for the media collections: `s.imagedir()`, `s.filedir()`, `s.fontdir()` and `s.videodir()`. The directory the uploads land in is now the first argument instead of the `dir` option:

```ts
// before
s.imageset({ dir: "/public/val/images", accept: "image/webp" });
s.fileset({ dir: "/public/val/docs", accept: "application/pdf" });
s.fontset({ dir: "/public/val/fonts" });
s.videoset({ dir: "/public/val/videos", stream: { type: "hls" } });

// after
s.imagedir("/public/val/images", { accept: "image/webp" });
s.filedir("/public/val/docs", { accept: "application/pdf" });
s.fontdir("/public/val/fonts");
s.videodir("/public/val/videos", { stream: { type: "hls" } });
```

Every other option is unchanged, and so is the content: a module only needs its schema call changed. The options object can now be left out entirely where nothing else is set, as in `s.fontdir("/public/val/fonts")`.

`s.imageset()`, `s.fileset()`, `s.fontset()` and `s.videoset()` still work and build exactly the same schema, but are deprecated and will be removed in a later release. The exported `VideosetEntryMetadata`, `VideosetOptions` and `SerializedVideosetSchema` types are deprecated in favour of `VideodirEntryMetadata`, `VideodirOptions` and `SerializedVideodirSchema`, and the image, file and font equivalents (`ImagedirOptions`, `ImagedirEntryMetadata`, `FiledirOptions`, `FiledirEntryMetadata`, `FontdirOptions`, `MediaDir`, …) are now exported too.
