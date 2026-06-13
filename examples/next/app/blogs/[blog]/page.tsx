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
  const author = authors[blog.author];
  return (
    <div>
      <h1>{blog.title}</h1>
      <aside>Author: {author.name}</aside>
      <ValRichText content={blog.content} />
      <Link href={blog.link.href}>{blog.link.label}</Link>
    </div>
  );
}
