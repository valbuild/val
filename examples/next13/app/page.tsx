"use client";
import styles from "./page.module.css";
import blogsVal from "./blogs.val";
import { useVal } from "@valbuild/react";

export default function Home() {
  const blogs = useVal(
    blogsVal.select((blogs) =>
      blogs.andThen((blogs) =>
        blogs
          .sortBy((blog) => blog.rank)
          .map((blog) => ({
            title: blog.title,
            text: blog.text,
          }))
      )
    )
  );
  return (
    <main className={styles.main}>
      <article className={styles.article}>
        {blogs.val &&
          blogs.map((blog) => (
            <section key={blog.valSrc} className={styles.blog}>
              <h1>{blog.title}</h1>
              <p>{blog.text}</p>
            </section>
          ))}
      </article>
    </main>
  );
}
