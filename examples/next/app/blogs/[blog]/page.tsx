"use server";
import { notFound } from "next/navigation";
import { fetchVal, fetchValRoute } from "../../../val/rsc";
import blogsVal from "./page.val";
import Link from "next/link";
import authorsVal from "../../../content/authors.val";
import { ValRichText } from "@valbuild/next";

export default async function BlogPage({
  params,
}: {
  params: Promise<{ blog: string }>;
}) {
  const blog = await fetchValRoute(blogsVal, params);
  const authors = await fetchVal(authorsVal);
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
