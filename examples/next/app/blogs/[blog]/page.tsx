"use client";
import { notFound } from "next/navigation";
import blogsVal from "./page.val";
import Link from "next/link";
import authorsVal from "../../../content/authors.val";
import { ValRichText } from "@valbuild/next";
import { useVal, useValRoute } from "../../../val/client";

export default function BlogPage({
  params,
}: {
  params: Promise<{ blog: string }>;
}) {
  const blog = useValRoute(blogsVal, params);
  const authors = useVal(authorsVal);
  if (!blog) {
    return notFound();
  }
  /**
   * A page that has just been created has no author yet.
   *
   * `s.keyOf` starts empty, so this lookup is `undefined` on any page made in
   * the Studio and not yet filled in — and reading `.name` off it threw, which
   * in the canvas is a runtime error overlay where the new page should be. The
   * content is genuinely incomplete; the page's job is to render what there is.
   */
  const author = blog.author ? authors[blog.author] : undefined;
  return (
    <div>
      <h1>{blog.title}</h1>
      {author && <aside>Author: {author.name}</aside>}
      <ValRichText content={blog.content} />
      <Link href={blog.link.href}>{blog.link.label}</Link>
    </div>
  );
}
