import blogsVal from "./blogs.val";
import { useVal } from "@valbuild/next";

export default async function Home() {
  const blogs = useVal(blogsVal);
  return (
    <main>
      <article>
        {blogs.map((blog) => (
          <section key={blog.title}>
            <h1>{blog.title}</h1>
            <img src={blog.image.url} />
          </section>
        ))}
      </article>
    </main>
  );
}
