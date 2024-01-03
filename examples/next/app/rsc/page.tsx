"use client";
import { ValImage, ValRichText } from "@valbuild/next";
import pageVal, { Content } from "../content.val";
import { useVal } from "../../val/client";

export default function Home() {
  // TODO: fetchVal instead
  const page: Content = useVal(pageVal);
  return (
    <main className="page content">
      <section className="hero full">
        <ValImage
          src={page.hero.image.data}
          alt={page.hero.image.alt}
          sizes={"(max-width: 400px) 200px, (max-width: 768px) 250px, 300px"}
          priority
        ></ValImage>
        {<h1 className="h1">{page.hero.title}</h1>}
      </section>
      <section>
        <video autoPlay muted>
          <source src={page.video.url} type={page.video.metadata?.mimeType} />
        </video>
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
