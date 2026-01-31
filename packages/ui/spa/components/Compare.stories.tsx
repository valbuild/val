import type { Meta, StoryObj } from "@storybook/react";
import { Compare } from "./Compare";
import { comparePatchSets } from "../utils/comparePatchSets";
import { PatchSets } from "../utils/PatchSets";
import {
  AllRichTextOptions,
  initVal,
  Json,
  ModuleFilePath,
  PatchId,
  RichTextSource,
} from "@valbuild/core";
import { applyPatch, deepClone, JSONOps, Patch } from "@valbuild/core/patch";
import { ValThemeProvider, Themes } from "./ValThemeProvider";
import { useState } from "react";

type TestPatch = {
  patchId: string;
  patch: Patch;
  createdAt: string;
  author: string | null;
};

// Helper to apply patches and generate PatchSets
function applyPatchesAndGetSets(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  schema: any,
  beforeSource: Json,
  patches: TestPatch[],
  moduleFilePath: ModuleFilePath = "/test.val.ts" as ModuleFilePath,
): {
  patchSets: PatchSets;
  afterSource: Json;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  serializedSchema: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  schema: any;
} {
  const patchSets = new PatchSets();
  const serializedSchema = schema["executeSerialize"]();
  let currentSource = beforeSource;
  const jsonOps = new JSONOps();

  for (const testPatch of patches) {
    for (const op of testPatch.patch) {
      patchSets.insert(
        moduleFilePath,
        serializedSchema,
        op,
        testPatch.patchId as PatchId,
        testPatch.createdAt,
        testPatch.author,
      );
    }
    const patchResult = applyPatch(
      deepClone(currentSource),
      jsonOps,
      testPatch.patch,
    );
    if (patchResult.kind === "ok") {
      currentSource = patchResult.value;
    } else {
      throw new Error(
        `Failed to apply patch: ${JSON.stringify(patchResult.error)}`,
      );
    }
  }

  return { patchSets, afterSource: currentSource, serializedSchema, schema };
}

const meta: Meta<typeof Compare> = {
  title: "Components/Compare",
  component: Compare,
  parameters: {
    layout: "padded",
  },
  decorators: [
    (Story) => {
      const [theme, setTheme] = useState<Themes | null>(null);
      return (
        <ValThemeProvider theme={theme} setTheme={setTheme} config={undefined}>
          <div className="max-w-4xl mx-auto p-6">
            <Story />
          </div>
        </ValThemeProvider>
      );
    },
  ],
};

export default meta;
type Story = StoryObj<typeof meta>;

export const NestedDiscriminatedUnion: Story = {
  name: "Nested Discriminated Union with Images",
  render: () => {
    const { s, c } = initVal();

    // Create a complex nested schema with discriminated unions
    const schema = s.object({
      items: s.array(
        s.union(
          "kind",
          s.object({
            kind: s.literal("section"),
            title: s.string(),
            blocks: s.array(
              s.union(
                "type",
                s.object({
                  type: s.literal("paragraph"),
                  text: s.string(),
                }),
                s.object({
                  type: s.literal("image"),
                  url: s.string(),
                  alt: s.string(),
                }),
                s.object({
                  type: s.literal("image-file"),
                  image: s.image(),
                }),
                s.object({
                  type: s.literal("code"),
                  language: s.string(),
                  code: s.string(),
                }),
              ),
            ),
          }),
          s.object({
            kind: s.literal("divider"),
            style: s.string(),
          }),
          s.object({
            kind: s.literal("callout"),
            type: s.string(),
            message: s.string(),
          }),
        ),
      ),
    });

    const beforeSource: Json = {
      items: [
        {
          kind: "section",
          title: "Introduction",
          blocks: [
            { type: "paragraph", text: "Welcome to our documentation." },
            {
              type: "image",
              url: "/images/old-banner.png",
              alt: "Old banner",
            },
            {
              type: "image-file",
              image: c.file("/public/val/old-image.jpg", {
                width: 800,
                height: 600,
                mimeType: "image/jpeg",
              }),
            },
          ],
        },
        {
          kind: "callout",
          type: "info",
          message: "This is important information.",
        },
        {
          kind: "section",
          title: "Getting Started",
          blocks: [
            {
              type: "paragraph",
              text: "Follow these steps to get started.",
            },
            {
              type: "code",
              language: "javascript",
              code: "const x = 42;",
            },
          ],
        },
      ],
    };

    const patches: TestPatch[] = [
      {
        patchId: "patch1",
        patch: [
          {
            op: "replace",
            path: ["items", "0", "blocks", "1", "url"],
            value: "/images/new-banner.png",
          },
        ],
        createdAt: "2026-01-30T10:00:00Z",
        author: "alice@example.com",
      },
      {
        patchId: "patch2",
        patch: [
          {
            op: "replace",
            path: ["items", "0", "blocks", "1", "alt"],
            value: "New banner image",
          },
        ],
        createdAt: "2026-01-30T10:05:00Z",
        author: "alice@example.com",
      },
      {
        patchId: "patch2b",
        patch: [
          {
            op: "replace",
            path: ["items", "0", "blocks", "2", "image"],
            value: c.file("/public/val/new-image.jpg", {
              width: 1200,
              height: 800,
              mimeType: "image/jpeg",
            }),
          },
        ],
        createdAt: "2026-01-30T10:06:00Z",
        author: "alice@example.com",
      },
      {
        patchId: "patch3",
        patch: [
          {
            op: "replace",
            path: ["items", "2", "blocks", "1", "code"],
            value: "const x = 100;\\nconsole.log(x);",
          },
        ],
        createdAt: "2026-01-30T10:10:00Z",
        author: "bob@example.com",
      },
      {
        patchId: "patch4",
        patch: [
          {
            op: "replace",
            path: ["items", "1", "message"],
            value: "This is CRITICAL information!",
          },
        ],
        createdAt: "2026-01-30T10:15:00Z",
        author: "carol@example.com",
      },
    ];

    const {
      patchSets,
      afterSource,
      serializedSchema,
      schema: rootSchema,
    } = applyPatchesAndGetSets(schema, beforeSource, patches);

    const comparisons = comparePatchSets(
      rootSchema,
      serializedSchema,
      patchSets.serialize(),
      beforeSource,
      afterSource,
      "/test.val.ts" as ModuleFilePath,
    );

    return (
      <div>
        <div className="mb-6">
          <h2 className="text-2xl font-bold mb-2">
            Nested Discriminated Union Changes
          </h2>
          <p className="text-text-secondary">
            This example shows changes in a complex nested structure with
            discriminated unions. The schema contains an array of sections with
            different block types (paragraph, image, code) and other item types
            (divider, callout).
          </p>
        </div>
        <Compare comparisons={comparisons} />
      </div>
    );
  },
};

export const RecordMoveOperation: Story = {
  name: "Record Move Operation",
  render: () => {
    const { s } = initVal();

    // Create a schema with a record of authors keyed by email
    const schema = s.object({
      authors: s.record(
        s.object({
          name: s.string(),
          age: s.number(),
        }),
      ),
    });

    const beforeSource: Json = {
      authors: {
        "alice@oldcompany.com": {
          name: "Alice Johnson",
          age: 32,
        },
        "bob@example.com": {
          name: "Bob Smith",
          age: 28,
        },
        "carol@startup.io": {
          name: "Carol White",
          age: 45,
        },
      },
    };

    const patches: TestPatch[] = [
      {
        patchId: "patch1",
        patch: [
          {
            op: "move",
            from: ["authors", "alice@oldcompany.com"],
            path: ["authors", "alice@newcompany.com"],
          },
        ],
        createdAt: "2026-01-30T10:00:00Z",
        author: "admin@example.com",
      },
      {
        patchId: "patch2",
        patch: [
          {
            op: "move",
            from: ["authors", "carol@startup.io"],
            path: ["authors", "carol@enterprise.com"],
          },
        ],
        createdAt: "2026-01-30T10:05:00Z",
        author: "admin@example.com",
      },
    ];

    const {
      patchSets,
      afterSource,
      serializedSchema,
      schema: rootSchema,
    } = applyPatchesAndGetSets(schema, beforeSource, patches);

    const comparisons = comparePatchSets(
      rootSchema,
      serializedSchema,
      patchSets.serialize(),
      beforeSource,
      afterSource,
      "/test.val.ts" as ModuleFilePath,
    );

    return (
      <div>
        <div className="mb-6">
          <h2 className="text-2xl font-bold mb-2">Record Move Operations</h2>
          <p className="text-text-secondary">
            This example shows move operations in a record of authors keyed by
            email. When an author changes their email address, a move operation
            updates the key while preserving their data (name and age). Each
            move creates two patch sets: removal from the old email key and
            addition at the new email key.
          </p>
        </div>
        <Compare comparisons={comparisons} />
      </div>
    );
  },
};

export const BlogPageEdits: Story = {
  name: "Blog Page Edits",
  render: () => {
    const { s, c } = initVal();

    // Minimal blog page schema based on the example
    const blogSchema = s.object({
      title: s.string(),
      content: s.richtext(),
      author: s.string(),
    });

    const pageSchema = s.object({
      blogs: s.record(blogSchema),
    });

    const beforeSource: Json = {
      blogs: {
        "/blogs/welcome": {
          title: "Welcome to Our Blog",
          content: [
            {
              tag: "p",
              children: ["This is the first post on our new blog!"],
            },
          ] satisfies RichTextSource<AllRichTextOptions>,
          author: "john",
        },
        "/blogs/getting-started": {
          title: "Getting Started",
          content: [
            {
              tag: "p",
              children: ["Learn the basics in this guide."],
            },
          ] satisfies RichTextSource<AllRichTextOptions>,
          author: "sarah",
        },
      },
    };

    const patches: TestPatch[] = [
      // Edit the title of welcome blog
      {
        patchId: "patch1",
        patch: [
          {
            op: "replace",
            path: ["blogs", "/blogs/welcome", "title"],
            value: "Welcome to Our Amazing Blog!",
          },
        ],
        createdAt: "2026-01-30T09:00:00Z",
        author: "editor",
      },
      // Update content with richer text
      {
        patchId: "patch2",
        patch: [
          {
            op: "replace",
            path: ["blogs", "/blogs/welcome", "content"],
            value: [
              {
                tag: "p",
                children: [
                  "This is the ",
                  { tag: "span", styles: ["bold"], children: ["first post"] },
                  " on our new blog! We're excited to share our journey.",
                ],
              },
            ] satisfies RichTextSource<AllRichTextOptions>,
          },
        ],
        createdAt: "2026-01-30T09:05:00Z",
        author: "editor",
      },
    ];

    const {
      patchSets,
      afterSource,
      serializedSchema,
      schema: rootSchema,
    } = applyPatchesAndGetSets(pageSchema, beforeSource, patches);

    const comparisons = comparePatchSets(
      rootSchema,
      serializedSchema,
      patchSets.serialize(),
      beforeSource,
      afterSource,
      "/test.val.ts" as ModuleFilePath,
    );

    return (
      <div>
        <div className="mb-6">
          <h2 className="text-2xl font-bold mb-2">Blog Page Edits</h2>
          <p className="text-text-secondary">
            Editing a blog page title and enriching the content with formatted
            text.
          </p>
        </div>
        <Compare comparisons={comparisons} />
      </div>
    );
  },
};

export const AddNewBlogAndAuthor: Story = {
  name: "Add New Blog & Author Change",
  render: () => {
    const { s, c } = initVal();

    const blogSchema = s.object({
      title: s.string(),
      content: s.richtext(),
      author: s.string(),
    });

    const pageSchema = s.object({
      blogs: s.record(blogSchema),
    });

    const beforeSource: Json = {
      blogs: {
        "/blogs/first": {
          title: "First Post",
          content: [
            { tag: "p", children: ["Content here"] },
          ] satisfies RichTextSource<AllRichTextOptions>,
          author: "alice",
        },
      },
    };

    const patches: TestPatch[] = [
      // Add a new blog post
      {
        patchId: "patch1",
        patch: [
          {
            op: "add",
            path: ["blogs", "/blogs/second"],
            value: {
              title: "Second Post",
              content: [
                {
                  tag: "p",
                  children: ["This is our second exciting post!"],
                },
              ] satisfies RichTextSource<AllRichTextOptions>,
              author: "bob",
            },
          },
        ],
        createdAt: "2026-01-30T10:00:00Z",
        author: "content-manager",
      },
      // Change author of first post
      {
        patchId: "patch2",
        patch: [
          {
            op: "replace",
            path: ["blogs", "/blogs/first", "author"],
            value: "charlie",
          },
        ],
        createdAt: "2026-01-30T10:05:00Z",
        author: "admin",
      },
    ];

    const {
      patchSets,
      afterSource,
      serializedSchema,
      schema: rootSchema,
    } = applyPatchesAndGetSets(pageSchema, beforeSource, patches);

    const comparisons = comparePatchSets(
      rootSchema,
      serializedSchema,
      patchSets.serialize(),
      beforeSource,
      afterSource,
      "/test.val.ts" as ModuleFilePath,
    );

    return (
      <div>
        <div className="mb-6">
          <h2 className="text-2xl font-bold mb-2">Add Blog & Change Author</h2>
          <p className="text-text-secondary">
            Adding a new blog post and changing the author of an existing one.
          </p>
        </div>
        <Compare comparisons={comparisons} />
      </div>
    );
  },
};

export const RenameBlogPath: Story = {
  name: "Rename Blog Path (Move)",
  render: () => {
    const { s } = initVal();

    const blogSchema = s.object({
      title: s.string(),
      content: s.richtext(),
      author: s.string(),
    });

    const pageSchema = s.object({
      blogs: s.record(blogSchema),
    });

    const beforeSource: Json = {
      blogs: {
        "/blogs/draft-post": {
          title: "Draft Post",
          content: [
            { tag: "p", children: ["This was a draft."] },
          ] satisfies RichTextSource<AllRichTextOptions>,
          author: "writer",
        },
        "/blogs/published": {
          title: "Published Post",
          content: [
            { tag: "p", children: ["Already published."] },
          ] satisfies RichTextSource<AllRichTextOptions>,
          author: "editor",
        },
      },
    };

    const patches: TestPatch[] = [
      // Rename draft-post to final-post (move operation)
      {
        patchId: "patch1",
        patch: [
          {
            op: "move",
            from: ["blogs", "/blogs/draft-post"],
            path: ["blogs", "/blogs/final-post"],
          },
        ],
        createdAt: "2026-01-30T11:00:00Z",
        author: "editor",
      },
    ];

    const {
      patchSets,
      afterSource,
      serializedSchema,
      schema: rootSchema,
    } = applyPatchesAndGetSets(pageSchema, beforeSource, patches);

    const comparisons = comparePatchSets(
      rootSchema,
      serializedSchema,
      patchSets.serialize(),
      beforeSource,
      afterSource,
      "/test.val.ts" as ModuleFilePath,
    );

    return (
      <div>
        <div className="mb-6">
          <h2 className="text-2xl font-bold mb-2">Rename Blog Path</h2>
          <p className="text-text-secondary">
            Renaming a blog from draft-post to final-post using a move
            operation.
          </p>
        </div>
        <Compare comparisons={comparisons} />
      </div>
    );
  },
};

export const RichTextEditing: Story = {
  name: "Rich Text Content Editing",
  render: () => {
    const { s } = initVal();

    const schema = s.object({
      article: s.richtext(),
    });

    const beforeSource: Json = {
      article: [
        {
          tag: "h1",
          children: ["Simple Title"],
        },
        {
          tag: "p",
          children: ["A basic paragraph with no formatting."],
        },
      ] satisfies RichTextSource<AllRichTextOptions>,
    };

    const patches: TestPatch[] = [
      // Make the content richer with formatting
      {
        patchId: "patch1",
        patch: [
          {
            op: "replace",
            path: ["article"],
            value: [
              {
                tag: "h1",
                children: ["Enhanced Title with Style"],
              },
              {
                tag: "p",
                children: [
                  "A ",
                  { tag: "span", styles: ["bold"], children: ["bold"] },
                  " paragraph with ",
                  { tag: "span", styles: ["italic"], children: ["italic"] },
                  " text.",
                ],
              },
              {
                tag: "ul",
                children: [
                  {
                    tag: "li",
                    children: [{ tag: "p", children: ["First item"] }],
                  },
                  {
                    tag: "li",
                    children: [{ tag: "p", children: ["Second item"] }],
                  },
                  {
                    tag: "li",
                    children: [{ tag: "p", children: ["Third item"] }],
                  },
                ],
              },
            ] satisfies RichTextSource<AllRichTextOptions>,
          },
        ],
        createdAt: "2026-01-30T12:00:00Z",
        author: "content-writer",
      },
    ];

    const {
      patchSets,
      afterSource,
      serializedSchema,
      schema: rootSchema,
    } = applyPatchesAndGetSets(schema, beforeSource, patches);

    const comparisons = comparePatchSets(
      rootSchema,
      serializedSchema,
      patchSets.serialize(),
      beforeSource,
      afterSource,
      "/test.val.ts" as ModuleFilePath,
    );

    return (
      <div>
        <div className="mb-6">
          <h2 className="text-2xl font-bold mb-2">Rich Text Editing</h2>
          <p className="text-text-secondary">
            Transforming plain text into richly formatted content with bold,
            italic, links, and lists.
          </p>
        </div>
        <Compare comparisons={comparisons} />
      </div>
    );
  },
};

export const MultipleAuthorsMultipleChanges: Story = {
  name: "Multiple Authors - Complex Scenario",
  render: () => {
    const { s } = initVal();

    const blogSchema = s.object({
      title: s.string(),
      content: s.richtext(),
      author: s.string(),
      published: s.boolean(),
    });

    const pageSchema = s.object({
      blogs: s.record(blogSchema),
    });

    const beforeSource: Json = {
      blogs: {
        "/blogs/post-1": {
          title: "First Blog Post",
          content: [
            { tag: "p", children: ["Original content"] },
          ] satisfies RichTextSource<AllRichTextOptions>,
          author: "alice",
          published: false,
        },
        "/blogs/post-2": {
          title: "Second Post",
          content: [
            { tag: "p", children: ["Second content"] },
          ] satisfies RichTextSource<AllRichTextOptions>,
          author: "bob",
          published: true,
        },
      },
    };

    const patches: TestPatch[] = [
      // Alice updates her own post content
      {
        patchId: "patch1",
        patch: [
          {
            op: "replace",
            path: ["blogs", "/blogs/post-1", "content"],
            value: [
              {
                tag: "p",
                children: ["Updated and improved content with more details!"],
              },
            ] satisfies RichTextSource<AllRichTextOptions>,
          },
        ],
        createdAt: "2026-01-30T08:00:00Z",
        author: "alice",
      },
      // Editor publishes Alice's post
      {
        patchId: "patch2",
        patch: [
          {
            op: "replace",
            path: ["blogs", "/blogs/post-1", "published"],
            value: true,
          },
        ],
        createdAt: "2026-01-30T08:30:00Z",
        author: "editor-team",
      },
      // Bob updates title
      {
        patchId: "patch3",
        patch: [
          {
            op: "replace",
            path: ["blogs", "/blogs/post-2", "title"],
            value: "Second Post - Updated",
          },
        ],
        createdAt: "2026-01-30T09:00:00Z",
        author: "bob",
      },
      // Admin adds a new post
      {
        patchId: "patch4",
        patch: [
          {
            op: "add",
            path: ["blogs", "/blogs/announcement"],
            value: {
              title: "Important Announcement",
              content: [
                {
                  tag: "p",
                  children: [
                    {
                      tag: "span",
                      styles: ["bold"],
                      children: ["Breaking news:"],
                    },
                    " We've launched a new feature!",
                  ],
                },
              ] satisfies RichTextSource<AllRichTextOptions>,
              author: "admin",
              published: true,
            },
          },
        ],
        createdAt: "2026-01-30T09:30:00Z",
        author: "system-admin",
      },
    ];

    const {
      patchSets,
      afterSource,
      serializedSchema,
      schema: rootSchema,
    } = applyPatchesAndGetSets(pageSchema, beforeSource, patches);

    const comparisons = comparePatchSets(
      rootSchema,
      serializedSchema,
      patchSets.serialize(),
      beforeSource,
      afterSource,
      "/test.val.ts" as ModuleFilePath,
    );

    return (
      <div>
        <div className="mb-6">
          <h2 className="text-2xl font-bold mb-2">
            Multiple Authors - Complex Workflow
          </h2>
          <p className="text-text-secondary">
            A realistic scenario with multiple content authors, editors, and
            admins making various changes: content updates, publishing, title
            edits, and new posts.
          </p>
        </div>
        <Compare comparisons={comparisons} />
      </div>
    );
  },
};

export const MultipleAuthorsOnePatchSet: Story = {
  name: "Multiple Authors - Same Change",
  render: () => {
    const { s } = initVal();

    const schema = s.object({
      title: s.string(),
      description: s.string(),
    });

    const beforeSource: Json = {
      title: "Original Title",
      description: "Original description text.",
    };

    // Simulate multiple people editing the same field (e.g., collaborative editing)
    // In a real scenario, this happens when patches from different authors affect the same path
    const patches: TestPatch[] = [
      {
        patchId: "patch1",
        patch: [
          {
            op: "replace",
            path: ["title"],
            value: "Updated Title",
          },
        ],
        createdAt: "2026-01-30T10:00:00Z",
        author: "alice",
      },
      {
        patchId: "patch1", // Same patchId - multiple authors contributed
        patch: [
          {
            op: "replace",
            path: ["title"],
            value: "Further Updated Title",
          },
        ],
        createdAt: "2026-01-30T10:01:00Z",
        author: "bob",
      },
      {
        patchId: "patch1", // Same patchId
        patch: [
          {
            op: "replace",
            path: ["title"],
            value: "Final Title Version",
          },
        ],
        createdAt: "2026-01-30T10:02:00Z",
        author: "charlie",
      },
      {
        patchId: "patch1", // Same patchId
        patch: [
          {
            op: "replace",
            path: ["title"],
            value: "Absolutely Final Title",
          },
        ],
        createdAt: "2026-01-30T10:03:00Z",
        author: "diana",
      },
      {
        patchId: "patch1", // Same patchId - 5th author
        patch: [
          {
            op: "replace",
            path: ["title"],
            value: "The Real Final Title",
          },
        ],
        createdAt: "2026-01-30T10:04:00Z",
        author: "editor-in-chief",
      },
      // Separate change to description by multiple authors
      {
        patchId: "patch2",
        patch: [
          {
            op: "replace",
            path: ["description"],
            value: "Updated description with more details.",
          },
        ],
        createdAt: "2026-01-30T10:05:00Z",
        author: "writer-1",
      },
      {
        patchId: "patch2", // Same patchId
        patch: [
          {
            op: "replace",
            path: ["description"],
            value: "Enhanced description with even more details and examples.",
          },
        ],
        createdAt: "2026-01-30T10:06:00Z",
        author: "writer-2",
      },
    ];

    const {
      patchSets,
      afterSource,
      serializedSchema,
      schema: rootSchema,
    } = applyPatchesAndGetSets(schema, beforeSource, patches);

    const comparisons = comparePatchSets(
      rootSchema,
      serializedSchema,
      patchSets.serialize(),
      beforeSource,
      afterSource,
      "/test.val.ts" as ModuleFilePath,
    );

    return (
      <div>
        <div className="mb-6">
          <h2 className="text-2xl font-bold mb-2">
            Multiple Authors - Same Patch Set
          </h2>
          <p className="text-text-secondary">
            Collaborative editing scenario where multiple authors contribute to
            the same changes. The title was edited by 5 different people (alice,
            bob, charlie, diana, editor-in-chief). Hover over the "+N" indicator
            to see all contributors.
          </p>
        </div>
        <Compare comparisons={comparisons} />
      </div>
    );
  },
};
