"use client";
import styles from "./page.module.css";
import blogsVal from "./blogs.val";
import { useVal } from "@valbuild/react";

export default function Home() {
  const a = blogsVal.select((blogs) =>
    blogs.andThen((blogs) =>
      blogs
        .filter((blog) => blog.text.eq(null))
        .map(({ title: title, text }) => ({ title, text }))
    )
  );
  const b = a.getVal(a.getModule().content.source, "en_US");
  if (b.val) {
    const d = b[0].title;
  }
  const c = blogsVal.select((it) => it.andThen((it) => [it[0]]));
  const blog = useVal(c);
  const blogs = blog;
  return (
    <main className={styles.main}>
      <article className={styles.article}>
        {blogs.map((blog) => (
          <section key={blog.valSrc} className={styles.blog}>
            <h1>{blog.title}</h1>
            <p>{blog.text}</p>
          </section>
        ))}
      </article>
    </main>
  );
}
