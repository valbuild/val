"use client";
import { ValRichText } from "@valbuild/next";
import pageVal, { Content } from "../content.val";
import { useVal } from "../../val/client";
import Image from "next/image";

export default function Home() {
  // TODO: fetchVal instead
  const page: Content = useVal(pageVal);
  const hotspot = page.hero.image.data.metadata?.hotspot;
  const imageStyle = hotspot
    ? { objectPosition: `${hotspot.x * 100}% ${hotspot.y * 100}%` }
    : {};

  return (
    <main className="page content">
      <section className="hero full">
        <img
          src={page.hero.image.data.url}
          alt={page.hero.image.alt}
          height={100}
          width={100}
          // sizes={sizes}
        ></img>
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
