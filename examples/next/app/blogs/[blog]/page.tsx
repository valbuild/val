"use server";
import { notFound } from "next/navigation";
import { fetchValRoute } from "../../../val/rsc";
import blogsVal from "./page.val";

export default async function BlogPage({
  params,
}: {
  params: Promise<{ blog: string }>;
}) {
  const blog = await fetchValRoute(blogsVal, params);
  if (!blog) {
    return notFound();
  }
  return (
    <div>
      <h1>{blog.title}</h1>
      <p>{blog.content}</p>
    </div>
  );
}
