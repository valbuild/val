/**
 * Phase 10's project at size, with nothing from Node or the Studio in it: the
 * generator half of `scaleWork.ts`, which re-exports it. Its own file so the
 * Cloudflare isolate probe (`isolate/`) can bundle it without the Studio's
 * stores, which `scaleWork.ts`'s surfaces import. See `scaleWork.ts`.
 */
import {
  Internal,
  initVal,
  type ModuleFilePath,
  type SelectorSource,
  type ValModule,
} from "@valbuild/core";

export type AnyModule = ValModule<SelectorSource>;

export const SCALE_SIZES = [1_000, 10_000, 100_000] as const;

/**
 * The sizes a run is asked for: `VAL_SCALE=1000,10000,100000`, or `fallback`.
 * Read by both callers, so one switch says what is measured.
 */
export function scaleSizesFrom(
  value: string | undefined,
  fallback: readonly number[],
): number[] {
  if (value === undefined || value.trim() === "") return [...fallback];
  const sizes = value
    .split(",")
    .map((part) => Number(part.trim()))
    .filter((n) => Number.isInteger(n) && n > 0);
  if (sizes.length === 0) {
    throw new Error(`VAL_SCALE: no sizes in ${JSON.stringify(value)}`);
  }
  return sizes;
}

export type MediaRefs = "local" | "remote";

const { s, c, config } = initVal({});

/** The config the scale project is defined with. */
export const scaleConfig = config;

export const POSTS = "/src/routes/_site.blog.$slug.val.ts" as ModuleFilePath;
export const IMAGES = "/content/media/images.val.ts" as ModuleFilePath;
export const FILES = "/content/media/files.val.ts" as ModuleFilePath;
export const VIDEOS = "/content/media/videos.val.ts" as ModuleFilePath;
export const FEATURED = "/content/featured.val.ts" as ModuleFilePath;

const REMOTE_HOST = "https://remote.val.build";

/** A ref of the shape the Studio writes for a remote upload (`createRemoteRef`). */
function remoteRef(filePath: `public/${string}`, i: number): string {
  const hash = i.toString(16).padStart(8, "0").repeat(5);
  return Internal.remote.createRemoteRef(REMOTE_HOST, {
    publicProjectId: "scale-project",
    coreVersion: Internal.VERSION.core ?? "0.0.0",
    validationHash: hash,
    fileHash: hash,
    filePath,
    bucket: "scale-bucket",
  });
}

function mediaPath(
  media: MediaRefs,
  dir: string,
  name: string,
  i: number,
): string {
  const local = `${dir}/${name}`;
  if (media === "local") return local;
  // `dir` is `/public/val/…`: the remote ref names it without the slash.
  return remoteRef(`public/${local.slice("/public/".length)}`, i);
}

export type ScaleProject = {
  entries: number;
  media: MediaRefs;
  modules: AnyModule[];
  posts: AnyModule;
  images: AnyModule;
  files: AnyModule;
  videos: AnyModule;
  featured: AnyModule;
  /** The posts' keys, in source order: what the record list shows. */
  postKeys: string[];
  imagePaths: string[];
  filePaths: string[];
  videoPaths: string[];
  /**
   * How many times a post's `c.json()` thunk was called: an entry IMPORTED
   * (in an app, a dynamic `import()` of its `*.val.json`). Every reader in the
   * process shares these thunks, so this counts the server's loads too.
   */
  imports: { count: number };
  /**
   * The `.val.ts` text of the router (and of the one post a publish writes),
   * for what a publish rewrites. The other entries' files are not generated:
   * at 100,000 they would be 50 MB of strings that nothing reads.
   */
  sourceText(publishedKeys: string[]): Record<string, string>;
};

/** The JSON of post `i`, as its `*.val.json` holds it. */
export function postEntry(i: number, imagePath: string) {
  return {
    title: `Post number ${i}`,
    slug: `post-${i}`,
    body: [
      {
        tag: "p" as const,
        children: [
          `The first paragraph of post ${i}, long enough to be a paragraph. `,
          {
            tag: "span" as const,
            styles: ["bold" as const],
            children: ["Some bold words"],
          },
        ],
      },
      { tag: "p" as const, children: [`The second paragraph of post ${i}.`] },
    ],
    image: { path: imagePath },
    tags: ["news", i % 2 === 0 ? "even" : "odd", `group-${i % 10}`],
  };
}

export function postKey(i: number): string {
  return `/blog/post-${i}`;
}

/**
 * A project of `entries` posts and three libraries of `entries` files each.
 * Content is built when the module is evaluated, as an app's bundle holds it;
 * a post's content only when its thunk is called.
 */
export function scaleProject(options: {
  entries: number;
  media: MediaRefs;
}): ScaleProject {
  const { entries: n, media } = options;
  const imageDir = "/public/val/images";
  const fileDir = "/public/val/files";
  const videoDir = "/public/val/videos";
  const imagePaths: string[] = [];
  const filePaths: string[] = [];
  const videoPaths: string[] = [];
  const imageEntries: Record<
    string,
    { width: number; height: number; mimeType: string; alt: string | null }
  > = {};
  const fileEntries: Record<string, { mimeType: string }> = {};
  const videoEntries: Record<
    string,
    {
      mimeType: string;
      width: number;
      height: number;
      duration: number;
      alt: string | null;
    }
  > = {};
  for (let i = 0; i < n; i++) {
    const image = mediaPath(media, imageDir, `image-${i}.png`, i);
    imagePaths.push(image);
    imageEntries[image] = {
      width: 1200,
      height: 800,
      mimeType: "image/png",
      alt: `Image ${i}`,
    };
    const file = mediaPath(media, fileDir, `file-${i}.pdf`, i);
    filePaths.push(file);
    fileEntries[file] = { mimeType: "application/pdf" };
    const video = mediaPath(media, videoDir, `video-${i}.mp4`, i);
    videoPaths.push(video);
    videoEntries[video] = {
      mimeType: "video/mp4",
      width: 1280,
      height: 720,
      duration: 12,
      alt: `Video ${i}`,
    };
  }

  const imageSchema = s.imagedir(imageDir, { alt: s.string().nullable() });
  const fileSchema = s.filedir(fileDir, { accept: "application/pdf" });
  const videoSchema = s.videodir(videoDir, { alt: s.string().nullable() });
  const images = c.define(
    IMAGES,
    media === "remote" ? imageSchema.remote() : imageSchema,
    imageEntries,
  );
  const files = c.define(
    FILES,
    media === "remote" ? fileSchema.remote() : fileSchema,
    fileEntries,
  );
  const videos = c.define(
    VIDEOS,
    media === "remote" ? videoSchema.remote() : videoSchema,
    videoEntries,
  );

  const post = s
    .object({
      title: s.string(),
      slug: s.string(),
      body: s.richtext({ bold: true }),
      image: s.image(images),
      tags: s.array(s.string()),
    })
    .preview(({ val }) => ({
      title: val.title,
      subtitle: val.slug,
      image: val.image,
    }));

  const imports = { count: 0 };
  const entryJson = (i: number) =>
    c.json(() => {
      imports.count++;
      return Promise.resolve({ default: postEntry(i, imagePaths[i]) });
    });
  const postKeys: string[] = [];
  const postSource: Record<string, ReturnType<typeof entryJson>> = {};
  for (let i = 0; i < n; i++) {
    const key = postKey(i);
    postKeys.push(key);
    postSource[key] = entryJson(i);
  }
  const posts = c.define(
    POSTS,
    s.router(Internal.tanstackRouter, post).jsonValues(),
    postSource,
  );

  const featured = c.define(
    FEATURED,
    s.object({
      title: s.string(),
      post: s.keyOf(posts),
      hero: s.image(images),
      download: s.file(files),
      clip: s.video(videos),
    }),
    {
      title: "Featured",
      post: postKeys[0],
      hero: { path: imagePaths[0] },
      download: { path: filePaths[0] },
      clip: { path: videoPaths[0] },
    },
  );

  const sourceText = (publishedKeys: string[]): Record<string, string> => {
    const lines = postKeys.map(
      (key) =>
        `    ${JSON.stringify(key)}: c.json(() => import("./blog/${key.slice("/blog/".length)}.val.json")),`,
    );
    const text: Record<string, string> = {
      [POSTS]: `import { c, s, tanstackRouter } from "../../val.config";
import imagesVal from "../../content/media/images.val";

export default c.define(
  "${POSTS}",
  s
    .router(
      tanstackRouter,
      s.object({
        title: s.string(),
        slug: s.string(),
        body: s.richtext({ bold: true }),
        image: s.image(imagesVal),
        tags: s.array(s.string()),
      }),
    )
    .jsonValues(),
  {
${lines.join("\n")}
  },
);
`,
    };
    for (const key of publishedKeys) {
      const i = postKeys.indexOf(key);
      text[`/src/routes/blog/${key.slice("/blog/".length)}.val.json`] =
        `${JSON.stringify(postEntry(i, imagePaths[i]), null, 2)}\n`;
    }
    return text;
  };

  return {
    entries: n,
    media,
    modules: [images, files, videos, posts, featured],
    posts,
    images,
    files,
    videos,
    featured,
    postKeys,
    imagePaths,
    filePaths,
    videoPaths,
    imports,
    sourceText,
  };
}
