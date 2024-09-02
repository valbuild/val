import { z } from "zod";

export const RemirrorTextMark = z.object({
  type: z.union([z.literal("bold"), z.literal("strike"), z.literal("italic")]),
});
export type RemirrorTextMark = z.infer<typeof RemirrorTextMark>;

export const RemirrorLinkMark = z.object({
  type: z.literal("link"),
  attrs: z.object({
    href: z.string(),
    target: z.union([z.literal("_blank"), z.null()]),
    auto: z.boolean(),
  }),
});
export type RemirrorLinkMark = z.infer<typeof RemirrorLinkMark>;

export const RemirrorText = z.intersection(
  z.object({
    type: z.literal("text"),
    text: z.string(),
  }),
  z
    .object({
      marks: z.array(z.union([RemirrorTextMark, RemirrorLinkMark])),
    })
    .partial(),
);
export type RemirrorText = z.infer<typeof RemirrorText>;

export const RemirrorBr = z.intersection(
  z.object({
    type: z.literal("hardBreak"),
  }),
  z
    .object({
      marks: z.array(RemirrorTextMark),
    })
    .partial(),
);
export type RemirrorBr = z.infer<typeof RemirrorBr>;

export const RemirrorImage = z.intersection(
  z.object({
    type: z.literal("image"),
  }),
  z
    .object({
      attrs: z.intersection(
        z.object({
          src: z.string(),
        }),
        z
          .object({
            align: z.union([
              z.literal("center"),
              z.literal("end"),
              z.literal("justify"),
              z.literal("left"),
              z.literal("match-parent"),
              z.literal("right"),
              z.literal("start"),
              z.null(),
            ]),
            alt: z.union([z.string(), z.null()]),
            height: z.union([z.string(), z.number(), z.null()]),
            width: z.union([z.string(), z.number(), z.null()]),
            rotate: z.union([z.string(), z.null()]),
            title: z.union([z.string(), z.null()]),
            fileName: z.union([z.string(), z.null()]),
          })
          .partial(),
      ),
    })
    .partial(),
);
export type RemirrorImage = z.infer<typeof RemirrorImage>;

export const RemirrorHeading = z.intersection(
  z.object({ type: z.literal("heading") }),
  z
    .object({
      attrs: z.object({
        level: z.number(),
      }),
      content: z.array(z.union([RemirrorText, RemirrorImage, RemirrorBr])),
    })
    .partial(),
);
export type RemirrorHeading = z.infer<typeof RemirrorHeading>;

export const RemirrorBulletList: z.ZodType<{
  type: "bulletList";
  content?: RemirrorListItem[];
}> = z.lazy(() =>
  z.intersection(
    z.object({ type: z.literal("bulletList") }),
    z
      .object({
        content: z.array(RemirrorListItem),
      })
      .partial(),
  ),
);
export type RemirrorBulletList = z.infer<typeof RemirrorBulletList>;

export const RemirrorOrderedList: z.ZodType<{
  type: "orderedList";
  content?: RemirrorListItem[];
}> = z.lazy(() =>
  z.intersection(
    z.object({ type: z.literal("orderedList") }),
    z
      .object({
        content: z.array(RemirrorListItem),
      })
      .partial(),
  ),
);
export type RemirrorOrderedList = z.infer<typeof RemirrorOrderedList>;

export const RemirrorListItem: z.ZodType<{
  type: "listItem";
  attrs?: {
    closed?: boolean;
    nested?: boolean;
  };
  content?: (RemirrorParagraph | RemirrorBulletList | RemirrorOrderedList)[];
}> = z.lazy(() =>
  z.intersection(
    z.object({ type: z.literal("listItem") }),
    z
      .object({
        attrs: z
          .object({ closed: z.boolean(), nested: z.boolean() })
          .partial()
          .optional(),
        content: z.array(
          z.union([RemirrorParagraph, RemirrorBulletList, RemirrorOrderedList]),
        ),
      })
      .partial(),
  ),
);
export type RemirrorListItem = z.infer<typeof RemirrorListItem>;

export const RemirrorParagraph: z.ZodType<{
  type: "paragraph";
  content?: (RemirrorText | RemirrorImage | RemirrorBr)[];
}> = z.lazy(() =>
  z.intersection(
    z.object({ type: z.literal("paragraph") }),
    z
      .object({
        content: z.array(z.union([RemirrorText, RemirrorImage, RemirrorBr])),
      })
      .partial(),
  ),
);
export type RemirrorParagraph = z.infer<typeof RemirrorParagraph>;

export const RemirrorJSON = z.object({
  type: z.literal("doc"),
  content: z.array(
    z.union([
      RemirrorParagraph,
      RemirrorHeading,
      RemirrorBulletList,
      RemirrorOrderedList,
    ]),
  ),
});
export type RemirrorJSON = z.infer<typeof RemirrorJSON>;
