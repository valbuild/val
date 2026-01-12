import { c, nextAppRouter, s } from "_/val.config";
import authorsVal from "../../../content/authors.val";
import { linkSchema } from "../../../components/link.val";

const blogSchema = s.object({
  title: s.string(),
  content: s.richtext(),
  author: s.keyOf(authorsVal),
  link: linkSchema,
});

export default c.define(
  "/app/blogs/[blog]/page.val.ts",
  s.router(nextAppRouter, blogSchema),
  {
    "/blogs/blog2": {
      title: "Blog 2",
      content: [
        {
          tag: "p",
          children: ["Blog 2 content"],
        },
      ],
      author: "freekh",
      link: {
        label: "Read more",
        href: "/blogs/blog1",
      },
    },
    "/blogs/blog1": {
      title: "Blog 1",
      content: [
        {
          tag: "p",
          children: ["Blog 1 content"],
        },
      ],
      author: "freekh",
      link: {
        label: "See more",
        href: "/generic/test/foo",
      },
    },
    "/blogs/blog-2": {
      title: "Blog 1",
      content: [
        {
          tag: "p",
          children: ["Blog 1 content"],
        },
      ],
      author: "freekh",
      link: {
        label: "See more",
        href: "/generic/test/foo",
      },
    },
    "/blogs/blog-3": {
      title: "Blog 1",
      content: [
        {
          tag: "p",
          children: ["Blog 1 content"],
        },
      ],
      author: "freekh",
      link: {
        label: "See more",
        href: "/generic/test/foo",
      },
    },
    "/blogs/blog-4": {
      title: "Blog 1",
      content: [
        {
          tag: "p",
          children: ["Blog 1 content"],
        },
      ],
      author: "freekh",
      link: {
        label: "See more",
        href: "/generic/test/foo",
      },
    },
    "/blogs/blog-5": {
      title: "Blog 1",
      content: [
        {
          tag: "p",
          children: ["Blog 1 content"],
        },
      ],
      author: "freekh",
      link: {
        label: "See more",
        href: "/generic/test/foo",
      },
    },
    "/blogs/blog-6": {
      title: "Blog 1",
      content: [
        {
          tag: "p",
          children: ["Blog 1 content"],
        },
      ],
      author: "freekh",
      link: {
        label: "See more",
        href: "/generic/test/foo",
      },
    },
    "/blogs/blog-7": {
      title: "Blog 1",
      content: [
        {
          tag: "p",
          children: ["Blog 1 content"],
        },
      ],
      author: "freekh",
      link: {
        label: "See more",
        href: "/generic/test/foo",
      },
    },
    "/blogs/blog-8": {
      title: "Blog 1",
      content: [
        {
          tag: "p",
          children: ["Blog 1 content"],
        },
      ],
      author: "freekh",
      link: {
        label: "See more",
        href: "/generic/test/foo",
      },
    },
    "/blogs/blog-9": {
      title: "Blog 1",
      content: [
        {
          tag: "p",
          children: ["Blog 1 content"],
        },
      ],
      author: "freekh",
      link: {
        label: "See more",
        href: "/generic/test/foo",
      },
    },
    "/blogs/blog-10": {
      title: "Blog 1",
      content: [
        {
          tag: "p",
          children: ["Blog 1 content"],
        },
      ],
      author: "freekh",
      link: {
        label: "See more",
        href: "/generic/test/foo",
      },
    },
    "/blogs/blog-11": {
      title: "Blog 1",
      content: [
        {
          tag: "p",
          children: ["Blog 1 content"],
        },
      ],
      author: "freekh",
      link: {
        label: "See more",
        href: "/generic/test/foo",
      },
    },
    "/blogs/blog-12": {
      title: "Blog 1",
      content: [
        {
          tag: "p",
          children: ["Blog 1 content"],
        },
      ],
      author: "freekh",
      link: {
        label: "See more",
        href: "/generic/test/foo",
      },
    },
    "/blogs/blog-13": {
      title: "Blog 1",
      content: [
        {
          tag: "p",
          children: ["Blog 1 content"],
        },
      ],
      author: "freekh",
      link: {
        label: "See more",
        href: "/generic/test/foo",
      },
    },
    "/blogs/blog-14": {
      title: "Blog 1",
      content: [
        {
          tag: "p",
          children: ["Blog 1 content"],
        },
      ],
      author: "freekh",
      link: {
        label: "See more",
        href: "/generic/test/foo",
      },
    },
    "/blogs/blog-15": {
      title: "Blog 1",
      content: [
        {
          tag: "p",
          children: ["Blog 1 content"],
        },
      ],
      author: "freekh",
      link: {
        label: "See more",
        href: "/generic/test/foo",
      },
    },
    "/blogs/blog-16": {
      title: "Blog 1",
      content: [
        {
          tag: "p",
          children: ["Blog 1 content"],
        },
      ],
      author: "freekh",
      link: {
        label: "See more",
        href: "/generic/test/foo",
      },
    },
    "/blogs/blog-17": {
      title: "Blog 1",
      content: [
        {
          tag: "p",
          children: ["Blog 1 content"],
        },
      ],
      author: "freekh",
      link: {
        label: "See more",
        href: "/generic/test/foo",
      },
    },
    "/blogs/blog-18": {
      title: "Blog 1",
      content: [
        {
          tag: "p",
          children: ["Blog 1 content"],
        },
      ],
      author: "freekh",
      link: {
        label: "See more",
        href: "/generic/test/foo",
      },
    },
    "/blogs/blog-19": {
      title: "Blog 1",
      content: [
        {
          tag: "p",
          children: ["Blog 1 content"],
        },
      ],
      author: "freekh",
      link: {
        label: "See more",
        href: "/generic/test/foo",
      },
    },
    "/blogs/blog-20": {
      title: "Blog 1",
      content: [
        {
          tag: "p",
          children: ["Blog 1 content"],
        },
      ],
      author: "freekh",
      link: {
        label: "See more",
        href: "/generic/test/foo",
      },
    },
    "/blogs/blog-21": {
      title: "Blog 1",
      content: [
        {
          tag: "p",
          children: ["Blog 1 content"],
        },
      ],
      author: "freekh",
      link: {
        label: "See more",
        href: "/generic/test/foo",
      },
    },
    "/blogs/blog-22": {
      title: "Blog 1",
      content: [
        {
          tag: "p",
          children: ["Blog 1 content"],
        },
      ],
      author: "freekh",
      link: {
        label: "See more",
        href: "/generic/test/foo",
      },
    },
    "/blogs/blog-23": {
      title: "Blog 1",
      content: [
        {
          tag: "p",
          children: ["Blog 1 content"],
        },
      ],
      author: "freekh",
      link: {
        label: "See more",
        href: "/generic/test/foo",
      },
    },
    "/blogs/blog-24": {
      title: "Blog 1",
      content: [
        {
          tag: "p",
          children: ["Blog 1 content"],
        },
      ],
      author: "freekh",
      link: {
        label: "See more",
        href: "/generic/test/foo",
      },
    },
    "/blogs/blog-25": {
      title: "Blog 1",
      content: [
        {
          tag: "p",
          children: ["Blog 1 content"],
        },
      ],
      author: "freekh",
      link: {
        label: "See more",
        href: "/generic/test/foo",
      },
    },
    "/blogs/blog-26": {
      title: "Blog 1",
      content: [
        {
          tag: "p",
          children: ["Blog 1 content"],
        },
      ],
      author: "freekh",
      link: {
        label: "See more",
        href: "/generic/test/foo",
      },
    },
    "/blogs/blog-27": {
      title: "Blog 1",
      content: [
        {
          tag: "p",
          children: ["Blog 1 content"],
        },
      ],
      author: "freekh",
      link: {
        label: "See more",
        href: "/generic/test/foo",
      },
    },
    "/blogs/blog-28": {
      title: "Blog 1",
      content: [
        {
          tag: "p",
          children: ["Blog 1 content"],
        },
      ],
      author: "freekh",
      link: {
        label: "See more",
        href: "/generic/test/foo",
      },
    },
    "/blogs/blog-29": {
      title: "Blog 1",
      content: [
        {
          tag: "p",
          children: ["Blog 1 content"],
        },
      ],
      author: "freekh",
      link: {
        label: "See more",
        href: "/generic/test/foo",
      },
    },
    "/blogs/blog-30": {
      title: "Blog 1",
      content: [
        {
          tag: "p",
          children: ["Blog 1 content"],
        },
      ],
      author: "freekh",
      link: {
        label: "See more",
        href: "/generic/test/foo",
      },
    },
    "/blogs/blog-31": {
      title: "Blog 1",
      content: [
        {
          tag: "p",
          children: ["Blog 1 content"],
        },
      ],
      author: "freekh",
      link: {
        label: "See more",
        href: "/generic/test/foo",
      },
    },
    "/blogs/blog-32": {
      title: "Blog 1",
      content: [
        {
          tag: "p",
          children: ["Blog 1 content"],
        },
      ],
      author: "freekh",
      link: {
        label: "See more",
        href: "/generic/test/foo",
      },
    },
    "/blogs/blog-33": {
      title: "Blog 1",
      content: [
        {
          tag: "p",
          children: ["Blog 1 content"],
        },
      ],
      author: "freekh",
      link: {
        label: "See more",
        href: "/generic/test/foo",
      },
    },
    "/blogs/blog-34": {
      title: "Blog 1",
      content: [
        {
          tag: "p",
          children: ["Blog 1 content"],
        },
      ],
      author: "freekh",
      link: {
        label: "See more",
        href: "/generic/test/foo",
      },
    },
    "/blogs/blog-35": {
      title: "Blog 1",
      content: [
        {
          tag: "p",
          children: ["Blog 1 content"],
        },
      ],
      author: "freekh",
      link: {
        label: "See more",
        href: "/generic/test/foo",
      },
    },
  },
);
