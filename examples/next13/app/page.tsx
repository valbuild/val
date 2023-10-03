"use client";
import { useVal } from "@valbuild/next/client";

import { ValRichText } from "@valbuild/next";
import blogsVal from "./blogs.val";

export default function Home() {
  const blogs = useVal(blogsVal);
  console.log(blogs.map((b) => b.text));
  return (
    <main>
      <article>
        {blogs.map((blog, i) => (
          <section key={i}>
            <h1>{blog.title}</h1>
            <img src={blog.image.url} />
            <ValRichText>{blog.text}</ValRichText>
          </section>
        ))}
      </article>
    </main>
  );
}
