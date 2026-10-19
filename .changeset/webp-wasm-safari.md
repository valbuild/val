---
"@valbuild/shared": patch
"@valbuild/ui": patch
---

`s.image({ encode: { type: "webp" } })` now produces WebP in Safari too, including on iPhone and iPad.

Safari's canvas cannot write WebP, so the Studio used to fall back to a JPEG (or a PNG) there, or to the original file when `accept` allowed only WebP. Now it encodes those images with libwebp, compiled to WebAssembly, at the same quality and size as everywhere else. The encoder is downloaded only by a browser that needs it, once per page, from `content.val.build`, the same place the Studio's bundler is served from. Browsers that can already write WebP never download it. If it cannot be loaded, uploads still work: the image is scaled down as a JPEG or PNG as before, or the original is uploaded.

Very large photos, like the 48 MP images from a newer iPhone's main camera, no longer fail to convert on iOS. Where the browser supports it, the Studio now decodes an image straight to its target size, so it never needs a canvas larger than the image it uploads.

A deployment that cannot reach `content.val.build` can serve the encoder itself and point the Studio at it with `globalThis.__VAL_WEBP_SIMD_WASM_URL__` and `globalThis.__VAL_WEBP_WASM_URL__`, the same way `__VAL_ROLLDOWN_WASM_URL__` works for the bundler.
