import blogsVal from "./blogs.val";
import { fetchVal } from "@valbuild/next";
import { ValRichText } from "@valbuild/next";

export default async function Home() {
  const blogs = await fetchVal(blogsVal);
  return (
    <main>
      <article>
        {blogs.map((blog) => (
          <section key={blog.title}>
            <h1>{blog.title}</h1>
            <img src={blog.image.url} />
            <ValRichText>{blog.text}</ValRichText>
          </section>
        ))}
      </article>
    </main>
  );
}
