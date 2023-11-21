"use client";
import { ValRichText } from "@valbuild/next";
import blogsVal from "./blogs.val";
import { useVal } from "@valbuild/next/client";
import { useEffect, useState } from "react";

export default function Home() {
  const blogs = useVal(blogsVal);
  const [state, setState] = useState(0);

  useEffect(() => {
    setState(1);
  }, []);

  return (
    <main>
      <style>
        {`
.font-bold {
  font-weight: bold;
}
.italic {
  font-style: italic;
}
.line-through {
  text-decoration: line-through;
}
        `}
      </style>
      <article>
        {state}
        <button
          onClick={() => {
            setState(2);
          }}
        >
          dsafdsaf
        </button>
        {blogs.map((blog, i) => (
          <section key={i}>
            <h1>{blog.title}</h1>
            <img src={blog.image.url} />
            <ValRichText
              theme={{
                tags: {
                  h1: "text-3xl font-bold",
                  h2: "text-xl font-bold",
                  img: "",
                },
                classes: {
                  bold: "font-bold",
                  italic: "italic",
                  lineThrough: "line-through",
                },
              }}
            >
              {blog.text}
            </ValRichText>
          </section>
        ))}
      </article>
    </main>
  );
}
