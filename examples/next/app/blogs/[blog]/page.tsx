"use server";
import { fetchVal } from "../../../val/rsc";
import blogsVal from "./page.val";

export default async function BlogPage({
  params,
}: {
  params: Promise<{ blog: string }>;
}) {
  const blogs = await fetchVal(blogsVal);
  const content = blogs[(await params).blog];
  return (
    <div>
      <h1>{content.title}</h1>
      <p>{content.content}</p>
    </div>
  );
}
