"use client";
import styles from "./page.module.css";
import blogsVal from "./blogs.val";
import { useVal, ValRichText } from "@valbuild/react";
import { val } from "../val.config";

export default function Home() {
  const blogs = useVal(blogsVal);
  return (
    <main className={styles.main}>
      <article className={styles.article}>
        {blogs.map((blog) => (
          <section key={val.key(blog)} className={styles.blog}>
            <h1>{blog.title}</h1>
            <img src={blog.image.url} />
            <ValRichText>{blog.text}</ValRichText>
          </section>
        ))}
      </article>
    </main>
  );
}
