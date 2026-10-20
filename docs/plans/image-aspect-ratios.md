# Image aspect ratios

> **Status: proposal.** Nothing below is implemented yet.

The ask: `s.image(...)` takes the aspect ratios the site will show the image at,
so an editor can see how the image will look in each place it is used, and
`ValImage` can render one of them.

---

## 1. What other CMSs do

There are two models. Either the CMS stores **one focal point** and previews the
ratios the developer declared, or it stores **one crop per named ratio** and the
editor adjusts each crop by hand.

| CMS                             | Ratios declared by the developer                                                                    | What the editor does                                                | What the frontend gets                                           |
| ------------------------------- | --------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------- | ---------------------------------------------------------------- |
| **Sanity** (since Studio v3.86) | `options.hotspot.previews: [{ title, aspectRatio }]` on the image type. Without it, a default set.  | Sets one hotspot and crop, and sees a preview per declared ratio.   | `hotspot` and `crop`. The frontend chooses the ratio.            |
| **Prismic**                     | "Responsive views": named `{ width, height }` constraints on the image field, set in Slice Machine. | Pans and zooms a separate crop for **each** view.                   | A `thumbnails` object with one URL per view.                     |
| **Umbraco** (Image Cropper)     | Named crops `{ alias, width, height }` on the data type.                                            | Adjusts a crop per alias, falling back to the focal point.          | `GetCropUrl("alias")`.                                           |
| **Drupal** (Image Widget Crop)  | "Crop types" with a ratio and a soft and hard minimum size, linked to image styles.                 | A crop per crop type, with a warning below the soft minimum.        | The image style URL.                                             |
| **Payload**                     | `imageSizes: [{ name, width, height, crop? }]` on the upload collection.                            | Sets one focal point and crop. The sizes are regenerated around it. | One generated file per size, under `sizes.<name>`.               |
| **Craft**                       | Named transforms `{ handle, mode: crop, width, height }`.                                           | Sets one focal point in the image editor.                           | `asset.getUrl("handle")`.                                        |
| **DatoCMS**                     | Nothing. Custom aspect ratios are an open feature request.                                          | Sets one focal point, and sees previews at a few fixed ratios.      | `fp-x`/`fp-y` imgix parameters, plus `ar` in the query.          |
| **Storyblok**                   | Nothing. The editor crops freely or uses presets (16:9, 2:3, 1:1).                                  | Sets one focus point.                                               | `focus`, used with the `filters:focal()` URL filter.             |
| **Contentful**                  | Nothing built in. A marketplace app adds a focal point.                                             | Sets one focal point (with the app).                                | Coordinates. Cropping is done with `fit` and `f` URL parameters. |

Takeaways:

- **Only Sanity puts declared ratios next to a focal point**, and it shipped
  that recently. It is the model closest to Val's, and the closest to what was
  asked for.
- **Naming the ratio** (Prismic's view name, Umbraco's alias, Payload's size
  name, Craft's handle) is how every CMS that has this answers "which size is
  used where". In each of them the frontend asks for the image **by that name**.
- **Per-ratio crops** (Prismic, Umbraco, Drupal) give editors the most control.
  The price is N crops to maintain per image, and the CMS has to serve a
  transformed file per crop.
- Val already took the focal-point side, on purpose. The prototype comment in
  `packages/ui/spa/components/shell/fields/HotspotPicker.tsx` says so: _"Val
  does not crop images — the customer's layout does… one point answers it for
  every ratio at once."_ That prototype even has a hardcoded `CROPS` list
  (16:9, 1:1, 3:4) of previews, but the real `ImageField` does not use it.

So the gap is small. The ratios should come from the schema rather than a
hardcoded list, they should have names and descriptions, and `ValImage` should
know them.

---

## 2. Proposal: named ratios, one focal point

### 2.1 Schema API

```ts
s.image({
  aspectRatios: {
    hero: { ratio: "21:9", description: "Full width at the top of the post" },
    card: { ratio: "4:3", description: "Blog list and related posts" },
    og: {
      ratio: "1.91:1",
      description: "Shared on social media",
      minWidth: 1200,
    },
    avatar: "1:1", // shorthand: no description
  },
});
```

- **It is a record, not an array.** The key is the name that `ValImage` takes,
  and it is what answers "where is it used". An array of bare ratios
  (`["16:9", "1:1"]`) would show the editor shapes with no meaning.
- **`ratio`** is `` `${number}:${number}` `` or a plain number (`1.91`). The
  string form is what designers write and what the Studio shows.
- **`description`** is input help (see the `describe` vs `preview` section of
  `.claude/CLAUDE.md`). It is shown only where the image is being edited.
- **`minWidth`** is optional. It produces a validation **warning** when the crop
  of this image at this ratio is narrower than that (Drupal's "soft limit").
  It depends on `docs/plans/validation-warnings.md`, and can ship later.
- **Galleries:**
  - `s.imagedir(dir, { aspectRatios })` declares the ratios for every entry.
    The gallery entry inspector then previews them under the default focal
    point.
  - `s.image(galleryVal, { aspectRatios })` declares a field's own ratios. Those
    are merged over the gallery's, with the field winning on a name both use.

Option types (`packages/core/src/schema/image.ts`):

```ts
export type AspectRatio = `${number}:${number}` | number;

export type AspectRatioOption =
  | AspectRatio
  | {
      ratio: AspectRatio;
      /** Where this ratio is used. Shown to the editor under the preview. */
      description?: string;
      /** Warn when this crop of the image is narrower than this, in pixels. */
      minWidth?: number;
    };

export type ImageOptions = {
  dir?: string;
  accept?: string;
  encode?: ImageEncodeOption;
  aspectRatios?: Record<string, AspectRatioOption>;
};
export type GalleryImageOptions = {
  encode?: ImageEncodeOption;
  aspectRatios?: Record<string, AspectRatioOption>;
};
```

`executeSerialize` writes `options` as-is, so the declaration reaches the Studio
without new code there. Three places need it by hand:

- **The zod `ImageOptions`** (`packages/shared/src/internal/zod/SerializedSchema.ts`)
  strips unknown keys, so `aspectRatios` must be added to it. Otherwise it
  disappears between the server and the Studio. The same goes for the record
  media options, for `s.imagedir`.
- **`getValidationBasis`** (`packages/core/src/remote/validationBasis.ts`) must
  `delete options.aspectRatios`, exactly as it deletes `encode` and `stream`.
  Adding a ratio says nothing about the bytes, and it must not invalidate every
  remote image.
- **The definition** is validated in `imageOf()`: a ratio of `0` or `"16:0"` is
  a developer error, so it should throw when the module is defined, rather than
  surface as a validation error on content.

Ratios are normalised to a number once, in core:

```ts
// packages/core/src/source/media.ts
export function parseAspectRatio(ratio: AspectRatio): number {
  if (typeof ratio === "number") return ratio;
  const [w, h] = ratio.split(":").map(Number);
  return w / h;
}
```

### 2.2 What the reader gets

`stegaEncode` already has the serialized schema in hand where it resolves an
image (`packages/react/src/stega/stegaEncode.ts`, the `fillFromGallery` branch),
so it can attach the declaration next to `url`:

```ts
export type Image = {
  readonly path: string;
  readonly url: ValEncodedString;
  readonly width?: number;
  readonly height?: number;
  readonly mimeType?: string;
  readonly alt?: string;
  readonly hotspot?: MediaHotspot;
  /** The ratios the schema declares, by name, as width / height. */
  readonly aspectRatios?: Readonly<Record<string, number>>;
};
```

Like `url`, this is generated at resolve time and never stored in the source.
Only the numbers are attached. The descriptions are for editors, so they do not
go into the page.

**Typing the name.** In the first version, `ratio` on `ValImage` is a `string`,
and an unknown name logs a `warn` in development. A typed name (`ratio="card"`
autocompleting, `ratio="crad"` failing to compile) means carrying the names from
`s.image(...)` through `ImageSchema<Src>` to `StegaOfSource`. That is a phantom
on `ImageSource`, and it touches the same `Selector`/`StegaOfSource` arms that
the `ValView` work found to be expensive. So it is worth doing, but as a second
step and with the "excessively deep" trap in mind.

### 2.3 `ValImage`

There is one new prop. The focal point already drives `object-position`, so a
ratio only adds the box around it.

```tsx
export type ValImageProps = Omit<
  React.ComponentProps<"img">,
  "src" | "alt" | "srcSet"
> & {
  alt?: string;
  src: Image;
  disableHotspot?: boolean;
  /**
   * One of the ratios the schema declares. The image is shown in a box of that
   * shape, filled and cropped around its focal point, exactly as the Studio
   * previews it.
   */
  ratio?: string;
};
```

TanStack (a plain `<img>`):

```tsx
const ratioValue = ratio !== undefined ? src.aspectRatios?.[ratio] : undefined;
if (ratio !== undefined && ratioValue === undefined) {
  Internal.log.warn(
    `ValImage: "${ratio}" is not one of the image's aspect ratios (${Object.keys(src.aspectRatios ?? {}).join(", ") || "none declared"})`,
  );
}
const imageStyle: React.CSSProperties = {
  ...(ratioValue !== undefined
    ? { aspectRatio: String(ratioValue), objectFit: "cover", height: "auto" }
    : {}),
  ...(hotspot && !disableHotspot
    ? { objectPosition: `${hotspot.x * 100}% ${hotspot.y * 100}%` }
    : {}),
  ...style, // the caller still wins
};
// With a ratio, the file's own height would give the element the file's shape,
// so only its width is used for reserving space.
```

Next (`next/image`) can do better. It needs `width` and `height` anyway, so it
is given the **crop's** dimensions instead of the file's. Then the generated
`srcset` and the space the browser reserves both have the right shape:

```tsx
const ratioValue = ratio !== undefined ? src.aspectRatios?.[ratio] : undefined;
const dims =
  ratioValue !== undefined && src.width
    ? { width: src.width, height: Math.round(src.width / ratioValue) }
    : { width: src.width, height: src.height };
<NextImage
  {...rest}
  {...dims}
  style={{ objectFit: "cover", ...hotspotStyle, ...style }}
/>;
```

Art direction (a different ratio at a different breakpoint) needs no new API,
because there is a single file and only the box changes. The caller switches
the class:

```tsx
<ValImage
  src={post.cover}
  className="aspect-[4/3] md:aspect-[21/9] object-cover"
/>
```

A helper can produce that from the declared ratios, without hardcoding the
numbers twice:

```ts
// @valbuild/react/stega
export function aspectRatioOf(src: Image, name: string): number | undefined;

<ValImage
  src={post.cover}
  style={{ "--card": aspectRatioOf(post.cover, "card"), "--hero": aspectRatioOf(post.cover, "hero") }}
  className="aspect-[var(--card)] md:aspect-[var(--hero)] object-cover"
/>
```

### 2.4 The Studio

**The image field** (`packages/ui/spa/components/fields/ImageField.tsx`). The
previews go into the existing "Focal point" section, right under
`FocalPointPicker`. `CropPreviews` from the shell prototype is the starting
point, driven by `imageSchema.options.aspectRatios` instead of the hardcoded
`CROPS`.

```
┌ Cover image ──────────────────────────────────────────────────────────┐
│ ┌────────────────────────────┐                                        │
│ │                            │   beach_a1b2c.jpg                      │
│ │            ⊕               │   2400 × 1600 · JPEG                   │
│ │                            │   [ Replace ]  [ Remove ]              │
│ └────────────────────────────┘                                        │
│                                                                       │
│ Description                                                           │
│ [ A dog running into the waves                                     ]  │
│                                                                       │
│ ▾ Focal point                                                         │
│   ┌──────────────────────────────────────────┐                        │
│   │                                          │                        │
│   │                   ⊕                      │  Drag to what must     │
│   │                                          │  stay in frame.        │
│   │                                          │                        │
│   └──────────────────────────────────────────┘                        │
│                                                                       │
│   Where this image is shown                                           │
│   ┌──────────────────────┐ ┌───────────┐ ┌──────────────┐ ┌───────┐   │
│   │          ⊕           │ │     ⊕     │ │      ⊕       │ │   ⊕   │   │
│   └──────────────────────┘ │           │ │              │ │       │   │
│   Hero · 21:9              └───────────┘ └──────────────┘ └───────┘   │
│   Full width at the top    Card · 4:3    Social · 1.91:1  Avatar 1:1  │
│   of the post              Blog list and Shared on social             │
│                            related posts media                        │
└───────────────────────────────────────────────────────────────────────┘
```

- **The previews are all the same height**, so the shapes compare at a glance.
  They are the same `object-fit: cover` and `object-position` that `ValImage`
  uses, so what the editor sees is arithmetic and not a promise.
- **Hovering or focusing a preview outlines its crop** on the focal point picker
  above, and dims what falls outside it. That answers "what gets cut off" while
  the point is being dragged:

```
   ┌──────────────────────────────────────────┐
   │░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░│
   │┌────────────────────────────────────────┐│
   ││                   ⊕                    ││ ← Hero · 21:9
   ││                                        ││
   │└────────────────────────────────────────┘│
   │░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░│
   └──────────────────────────────────────────┘
```

- **The previews update live while the point is dragged**, not only on
  pointer-up when the patch is written.
- **With `minWidth`**, a crop that is too small shows a warning under its
  preview, with the numbers that explain it:

```
   ┌──────────────┐
   │      ⊕       │   Social · 1.91:1
   └──────────────┘   ⚠ 1080 px wide here, needs 1200.
                        Use a larger image.  [ Replace ]
```

The warning offers **Replace**, because a bigger file is the only thing that
fixes it. Moving the focal point does not change the size of the crop.

- **No declared ratios** shows the section as it is today, with no previews. The
  Studio should not invent ratios the site does not use.
- **`ImageCard`** (the compact summary) is hardcoded to 16:9 today. It should
  use the **first** declared ratio, so a list of avatars shows squares.

**The gallery entry inspector** (`GalleryEntryInspector.tsx`). An entry's focal
point is the default for every field that picks it, so it should preview every
ratio those fields use. The Studio has every serialized schema, so it can find
the `s.image(galleryVal, ...)` fields that point at this gallery and merge
their ratios with the gallery's own:

```
┌ beach_a1b2c.jpg ──────────────────────────────────────────────┐
│ ┌──────────────────────────────────────┐                      │
│ │                 ⊕                    │  Default focal point │
│ └──────────────────────────────────────┘  for every field.    │
│                                                               │
│ Used as                                                       │
│ ┌──────────────────┐ ┌──────────┐ ┌──────┐                    │
│ │        ⊕         │ │    ⊕     │ │  ⊕   │                    │
│ └──────────────────┘ │          │ │      │                    │
│ Post cover · 21:9    └──────────┘ └──────┘                    │
│ /posts/[slug]        Card · 4:3   Author avatar · 1:1         │
│                      /posts       /authors                    │
└───────────────────────────────────────────────────────────────┘
```

The line under each preview names the module the ratio comes from, so the
editor knows which pages a change to the default affects.

---

## 3. The alternative: one crop per ratio (Prismic, Umbraco)

If editors need to compose each crop and not only keep a subject in frame, for
example a tight crop of a face for the avatar and the whole scene for the hero,
a single point is not enough. The shape would be an optional override per name,
next to `hotspot`:

```ts
{
  path: "/public/val/beach_a1b2c.jpg",
  hotspot: { x: 0.62, y: 0.4 },
  crops: {
    avatar: { x: 0.55, y: 0.2, width: 0.25 }, // fractions; height follows from the ratio
  },
}
```

```
   Hero · 21:9   Card · 4:3   Avatar · 1:1
   ⊕ focal pt    ⊕ focal pt   ✎ custom crop  [ Reset to focal point ]
```

Why this should not be the first version:

- **The browser cannot crop to a rectangle by itself.** `object-position`
  places a point; it cannot zoom. A custom crop needs either an image transform
  service (remote images could get one on `remote.val.build`, local ones
  cannot) or a CSS `transform: scale()` trick inside an `overflow: hidden` box.
  The trick downloads the whole file to show a corner of it.
- **It adds N things to keep up to date per image.** Every new ratio leaves
  every existing image without a crop for it, and a replaced image makes every
  crop stale.
- **It goes against the decision recorded in `HotspotPicker.tsx`.**

It fits on top of the proposal without breaking it. `crops` would be optional,
fall back to the focal point, and use the same names. So it can be added when
someone asks for it.

---

## 4. Touch points

| Where                                                             | What                                                                                                                                                                        |
| ----------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `core/src/schema/image.ts`                                        | `AspectRatio`, `AspectRatioOption`, and the option on `ImageOptions` / `GalleryImageOptions`. `imageOf()` passes the gallery field's option through and rejects bad ratios. |
| `core/src/schema/imagedir.ts`, `record.ts`                        | The option on `s.imagedir`, and in the record's media options and their serialization.                                                                                      |
| `core/src/source/media.ts`                                        | `parseAspectRatio`, and the field-over-gallery merge.                                                                                                                       |
| `core/src/remote/validationBasis.ts`                              | `delete options.aspectRatios`.                                                                                                                                              |
| `shared/src/internal/zod/SerializedSchema.ts`                     | Add the option to `ImageOptions` and to the record media options.                                                                                                           |
| `react/src/stega/stegaEncode.ts`                                  | `aspectRatios` on `Image`, attached at resolve time, plus the `aspectRatioOf` helper.                                                                                       |
| `tanstack/src/ValImage.tsx`, `next/src/ValImage.tsx`              | The `ratio` prop.                                                                                                                                                           |
| `ui/spa/components/fields/ImageField.tsx`, `FocalPointPicker.tsx` | The previews, the crop outline on hover, and live updates while dragging.                                                                                                   |
| `ui/spa/components/fields/GalleryEntryInspector.tsx`              | "Used as", collected from the referencing fields.                                                                                                                           |
| `ui/spa/components/fields/ImageCard.tsx`                          | Use the first declared ratio instead of 16:9.                                                                                                                               |
| `examples/tanstack`                                               | Declare ratios on `media.val.ts`'s `hero` and on the post `cover`, render them with `ratio=`, and add them to the showcase list in `.claude/CLAUDE.md`.                     |
| `architecture/media.md`                                           | Record the focal-point-not-crop decision there, where it is easier to find than in the prototype.                                                                           |

## 5. Open questions

1. **Should `s.richtext({ img: ... })` take the option too?** An inline image in
   rich text usually keeps its own shape, so probably not.
2. **Should `ratio` also accept a ratio that is not declared**
   (`ratio={16 / 9}`)? It would be convenient, but then the Studio previews
   stop telling the whole truth.
3. **`s.video()`** already uses the hotspot as `object-position` (`ValVideo`).
   The same option would work there unchanged, so should it be added in the same
   change?
