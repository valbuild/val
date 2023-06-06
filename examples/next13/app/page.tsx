import blogsVal from "./blogs.val";
import { ValRichText } from "@valbuild/react";
import { val } from "../val.config";
import { fetchVal } from "@valbuild/core";

export default async function Home() {
  const blogs = await fetchVal(blogsVal);
  return (
    <main>
      <article>
        {blogs.map((blog) => (
          <section key={val.key(blog)}>
            <h1>{blog.title}</h1>
            <img src={blog.image.url} />
            <ValRichText>{blog.text}</ValRichText>
          </section>
        ))}
      </article>
    </main>
  );
}
