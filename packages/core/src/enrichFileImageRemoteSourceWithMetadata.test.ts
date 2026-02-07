import { initVal } from "./initVal";
import { enrichFileImageRemoteSourceWithMetadata } from "./module";
import { FilesEntryMetadata } from "./schema/files";
import { ImagesEntryMetadata } from "./schema/images";
import { Internal } from ".";

describe("enrichFileImageRemoteSourceWithMetadata", () => {
  test("should enrich image source with metadata from images module", () => {
    const { c, s } = initVal();

    // Define an images module (like media.val.ts)
    const imagesModule = c.define(
      "/content/images.val.ts",
      s.images({
        accept: "image/webp",
        directory: "/public/val/images",
      }),
      {
        "/public/val/images/logo.png": {
          width: 800,
          height: 600,
          mimeType: "image/png",
          alt: "An example image",
        },
      } as Record<string, ImagesEntryMetadata>,
    );

    const testSchema = s.object({
      test: s.image(imagesModule),
    });

    const testModule = c.define("/content/test.val.ts", testSchema, {
      test: c.image("/public/val/images/logo.png"),
    });
    const source = Internal.getSource(testModule);
    const enrichedSource = enrichFileImageRemoteSourceWithMetadata(source, testSchema);
    expect(enrichedSource).toEqual({
      test: c.image("/public/val/images/logo.png", {
        width: 800,
        height: 600,
        mimeType: "image/png",
        alt: "An example image",
      }),
    });
  });

  test("should enrich deeply nested schema with multiple images, files, records, arrays, unions, and richtext", () => {
    const { c, s } = initVal();

    // Define 3 different images modules
    const avatarsModule = c.define(
      "/content/avatars.val.ts",
      s.images({
        accept: "image/*",
        directory: "/public/val/avatars",
      }),
      {
        "/public/val/avatars/john.png": {
          width: 200,
          height: 200,
          mimeType: "image/png",
          alt: "John's avatar",
        },
        "/public/val/avatars/jane.png": {
          width: 150,
          height: 150,
          mimeType: "image/png",
          alt: "Jane's avatar",
        },
      } as Record<string, ImagesEntryMetadata>,
    );

    // Remote images module - uses c.remote() instead of c.image()
    const productsModule = c.define(
      "/content/products.val.ts",
      s.images({
        accept: "image/*",
        directory: "/public/val/products",
      }).remote(),
      {
        "https://example.com/file/p/test/b/default/v/1.0.0/h/abc123/f/widget123/p/public/val/products/widget.jpg": {
          width: 600,
          height: 400,
          mimeType: "image/jpeg",
          alt: "Widget product",
        },
        "https://example.com/file/p/test/b/default/v/1.0.0/h/abc123/f/gadget456/p/public/val/products/gadget.jpg": {
          width: 800,
          height: 600,
          mimeType: "image/jpeg",
          alt: "Gadget product",
        },
        "https://example.com/file/p/test/b/default/v/1.0.0/h/abc123/f/inline789/p/public/val/products/inline-product.png": {
          width: 100,
          height: 100,
          mimeType: "image/png",
          alt: "Inline product image",
        },
      } as Record<string, ImagesEntryMetadata>,
    );

    const bannersModule = c.define(
      "/content/banners.val.ts",
      s.images({
        accept: "image/*",
        directory: "/public/val/banners",
      }),
      {
        "/public/val/banners/hero.webp": {
          width: 1920,
          height: 1080,
          mimeType: "image/webp",
          alt: "Hero banner",
        },
        "/public/val/banners/promo.webp": {
          width: 1200,
          height: 600,
          mimeType: "image/webp",
          alt: "Promo banner",
        },
      } as Record<string, ImagesEntryMetadata>,
    );

    // Define 1 files module
    const documentsModule = c.define(
      "/content/documents.val.ts",
      s.files({
        accept: "application/pdf",
        directory: "/public/val/documents",
      }),
      {
        "/public/val/documents/manual.pdf": {
          mimeType: "application/pdf",
        },
        "/public/val/documents/brochure.pdf": {
          mimeType: "application/pdf",
        },
      } as Record<string, { mimeType: string }>,
    );

    // Create deeply nested schema with all combinations
    const deepSchema = s.object({
      // Simple nested object with image
      header: s.object({
        banner: s.image(bannersModule),
      }),

      // Record -> Object -> Image
      users: s.record(
        s.object({
          name: s.string(),
          avatar: s.image(avatarsModule),
        }),
      ),

      // Array -> Object -> Object -> Array -> Image (deep nesting)
      products: s.array(
        s.object({
          name: s.string(),
          details: s.object({
            description: s.string(),
            gallery: s.array(s.image(productsModule)),
          }),
        }),
      ),

      // Array -> Union with different types at each variant
      contentBlocks: s.array(
        s.union(
          "type",
          s.object({
            type: s.literal("hero"),
            backgroundImage: s.image(bannersModule),
          }),
          s.object({
            type: s.literal("product"),
            productImage: s.image(productsModule),
          }),
          s.object({
            type: s.literal("document"),
            file: s.file(documentsModule),
          }),
          s.object({
            type: s.literal("article"),
            body: s.richtext({
              inline: {
                img: s.image(productsModule),
              },
            }),
          }),
        ),
      ),

      // Union at object level
      sidebar: s.union(
        "variant",
        s.object({
          variant: s.literal("promo"),
          promoImage: s.image(bannersModule),
        }),
        s.object({
          variant: s.literal("download"),
          downloadFile: s.file(documentsModule),
        }),
      ),

      // Deep 3-level object nesting with richtext at bottom
      nested: s.object({
        level1: s.object({
          level2: s.object({
            level3: s.object({
              deepImage: s.image(avatarsModule),
              richContent: s.richtext({
                inline: {
                  img: s.image(avatarsModule),
                },
              }),
            }),
          }),
        }),
      }),
    });

    // Create test data
    const testModule = c.define("/content/deep-test.val.ts", deepSchema, {
      header: {
        banner: c.image("/public/val/banners/hero.webp"),
      },

      users: {
        john: {
          name: "John Doe",
          avatar: c.image("/public/val/avatars/john.png"),
        },
        jane: {
          name: "Jane Smith",
          avatar: c.image("/public/val/avatars/jane.png"),
        },
      },

      products: [
        {
          name: "Widget",
          details: {
            description: "A useful widget",
            gallery: [
              c.remote("https://example.com/file/p/test/b/default/v/1.0.0/h/abc123/f/widget123/p/public/val/products/widget.jpg", { mimeType: "image/jpeg" }),
              c.remote("https://example.com/file/p/test/b/default/v/1.0.0/h/abc123/f/gadget456/p/public/val/products/gadget.jpg", { mimeType: "image/jpeg" }),
            ],
          },
        },
      ],

      contentBlocks: [
        {
          type: "hero" as const,
          backgroundImage: c.image("/public/val/banners/hero.webp"),
        },
        {
          type: "product" as const,
          productImage: c.remote("https://example.com/file/p/test/b/default/v/1.0.0/h/abc123/f/widget123/p/public/val/products/widget.jpg", { mimeType: "image/jpeg" }),
        },
        {
          type: "document" as const,
          file: c.file("/public/val/documents/manual.pdf"),
        },
        {
          type: "article" as const,
          body: [
            {
              tag: "p",
              children: [
                "Check out this product: ",
                {
                  tag: "img",
                  src: c.remote("https://example.com/file/p/test/b/default/v/1.0.0/h/abc123/f/inline789/p/public/val/products/inline-product.png", { mimeType: "image/png" }),
                },
              ],
            },
          ],
        },
      ],

      sidebar: {
        variant: "promo" as const,
        promoImage: c.image("/public/val/banners/promo.webp"),
      },

      nested: {
        level1: {
          level2: {
            level3: {
              deepImage: c.image("/public/val/avatars/john.png"),
              richContent: [
                {
                  tag: "p",
                  children: [
                    "Deep content with image: ",
                    {
                      tag: "img",
                      src: c.image("/public/val/avatars/jane.png"),
                    },
                  ],
                },
              ],
            },
          },
        },
      },
    });

    const source = Internal.getSource(testModule);
    const enrichedSource = enrichFileImageRemoteSourceWithMetadata(
      source,
      deepSchema,
    ) as typeof source;

    // Verify header banner
    expect(enrichedSource.header.banner).toEqual(
      c.image("/public/val/banners/hero.webp", {
        width: 1920,
        height: 1080,
        mimeType: "image/webp",
        alt: "Hero banner",
      }),
    );

    // Verify record -> object -> image
    expect(enrichedSource.users.john.avatar).toEqual(
      c.image("/public/val/avatars/john.png", {
        width: 200,
        height: 200,
        mimeType: "image/png",
        alt: "John's avatar",
      }),
    );
    expect(enrichedSource.users.jane.avatar).toEqual(
      c.image("/public/val/avatars/jane.png", {
        width: 150,
        height: 150,
        mimeType: "image/png",
        alt: "Jane's avatar",
      }),
    );

    // Verify array -> object -> object -> array -> remote image
    expect(enrichedSource.products[0].details.gallery[0]).toEqual(
      c.remote("https://example.com/file/p/test/b/default/v/1.0.0/h/abc123/f/widget123/p/public/val/products/widget.jpg", {
        width: 600,
        height: 400,
        mimeType: "image/jpeg",
        alt: "Widget product",
      }),
    );
    expect(enrichedSource.products[0].details.gallery[1]).toEqual(
      c.remote("https://example.com/file/p/test/b/default/v/1.0.0/h/abc123/f/gadget456/p/public/val/products/gadget.jpg", {
        width: 800,
        height: 600,
        mimeType: "image/jpeg",
        alt: "Gadget product",
      }),
    );

    // Verify array -> union variants
    const heroBlock = enrichedSource.contentBlocks[0] as {
      type: "hero";
      backgroundImage: ReturnType<typeof c.image>;
    };
    expect(heroBlock.backgroundImage).toEqual(
      c.image("/public/val/banners/hero.webp", {
        width: 1920,
        height: 1080,
        mimeType: "image/webp",
        alt: "Hero banner",
      }),
    );

    const productBlock = enrichedSource.contentBlocks[1] as {
      type: "product";
      productImage: ReturnType<typeof c.remote>;
    };
    expect(productBlock.productImage).toEqual(
      c.remote("https://example.com/file/p/test/b/default/v/1.0.0/h/abc123/f/widget123/p/public/val/products/widget.jpg", {
        width: 600,
        height: 400,
        mimeType: "image/jpeg",
        alt: "Widget product",
      }),
    );

    const documentBlock = enrichedSource.contentBlocks[2] as {
      type: "document";
      file: ReturnType<typeof c.file>;
    };
    expect(documentBlock.file).toEqual(
      c.file("/public/val/documents/manual.pdf", {
        mimeType: "application/pdf",
      }),
    );

    // Verify richtext inline remote image in union
    const articleBlock = enrichedSource.contentBlocks[3] as {
      type: "article";
      body: Array<{
        tag: string;
        children: Array<
          string | { tag: string; src: ReturnType<typeof c.remote> }
        >;
      }>;
    };
    const inlineImg = articleBlock.body[0].children[1] as {
      tag: string;
      src: ReturnType<typeof c.remote>;
    };
    expect(inlineImg.src).toEqual(
      c.remote("https://example.com/file/p/test/b/default/v/1.0.0/h/abc123/f/inline789/p/public/val/products/inline-product.png", {
        width: 100,
        height: 100,
        mimeType: "image/png",
        alt: "Inline product image",
      }),
    );

    // Verify sidebar union
    const sidebarPromo = enrichedSource.sidebar as {
      variant: "promo";
      promoImage: ReturnType<typeof c.image>;
    };
    expect(sidebarPromo.promoImage).toEqual(
      c.image("/public/val/banners/promo.webp", {
        width: 1200,
        height: 600,
        mimeType: "image/webp",
        alt: "Promo banner",
      }),
    );

    // Verify deep nested object with image
    expect(enrichedSource.nested.level1.level2.level3.deepImage).toEqual(
      c.image("/public/val/avatars/john.png", {
        width: 200,
        height: 200,
        mimeType: "image/png",
        alt: "John's avatar",
      }),
    );

    // Verify deep nested richtext inline image
    const deepRichContent = enrichedSource.nested.level1.level2.level3
      .richContent as Array<{
      tag: string;
      children: Array<
        string | { tag: string; src: ReturnType<typeof c.image> }
      >;
    }>;
    const deepInlineImg = deepRichContent[0].children[1] as {
      tag: string;
      src: ReturnType<typeof c.image>;
    };
    expect(deepInlineImg.src).toEqual(
      c.image("/public/val/avatars/jane.png", {
        width: 150,
        height: 150,
        mimeType: "image/png",
        alt: "Jane's avatar",
      }),
    );
  });
});
