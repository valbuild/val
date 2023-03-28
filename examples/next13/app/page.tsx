"use client";
import styles from "./page.module.css";
import blogsVal from "./blogs.val";
import { useVal } from "@valbuild/react";

export default function Home() {
  const blog = useVal(blogsVal.select((it) => it.andThen((it) => it[0])));
  const blogs = blog.val === null ? [] : [blog];
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
