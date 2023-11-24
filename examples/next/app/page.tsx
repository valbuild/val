"use client";
import { ValRichText } from "@valbuild/next";
import pageVal from "./content.val";
import Image from "next/image";
import { useVal } from "../val/client";

export default function Home() {
  const page = useVal(pageVal);
  return (
    <main className="page content">
      <section className="hero full">
        <Image
          src={page.hero.image.data.url}
          alt={page.hero.image.alt}
          width={200}
          height={200}
        />
        {<h1 className="h1">{page.hero.title}</h1>}
      </section>
      <section>
        {page.text && ( // text is optional
          <ValRichText
            theme={{
              p: "rt-paragraph", // optional
              // required based on the content:
              // NOTE: tailwind classes is supported (though tailwind is not used here):
              bold: "font-bold",
              italic: "font-italic",
              lineThrough: "line-through",
              // Classes for tags:
              li: "rt-list-item",
              ul: "rt-ul-list",
              h1: "rt-h1",
              h2: "rt-h2",
              h3: "rt-h3",
              h4: "rt-h4",
              h5: "rt-h5",
              h6: "rt-h6",
              img: "rt-image",
              ol: "rt-ol-list",
            }}
          >
            {page.text}
          </ValRichText>
        )}
      </section>
    </main>
  );
}
