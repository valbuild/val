"use client";
import { ValRichText } from "@valbuild/next";
import pageVal from "./content.val";
import { useVal } from "@valbuild/next/client";
import Image from "next/image";

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
    </main>
  );
}
