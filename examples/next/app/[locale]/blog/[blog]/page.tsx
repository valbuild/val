"use server";
import { notFound } from "next/navigation";
import { fetchVal, fetchValRoute } from "../../../../val/rsc";
import Link from "next/link";
import authorsVal from "../../../../content/authors.val";
import { ValRichText } from "@valbuild/next";
import enVal from "./en-us.val";
import nbVal from "./nb-no.val";
import { Blog } from "./schema.val";
import translationsVal from "./translations.val";

export default async function BlogPage({
  params,
}: {
  params: Promise<{ blog: string; locale: string }>;
}) {
  const { locale } = await params;
  const translations = await fetchVal(translationsVal);
  const blog = await fetchValRoute([enVal, nbVal], params);

  const authors = await fetchVal(authorsVal);
  if (!blog) {
    return notFound();
  }
  const author = authors[blog.author];
  return (
    <div>
      <h1>{blog.title}</h1>
      <aside>Author: {author.name}</aside>
      <ValRichText>{blog.content}</ValRichText>
      <Link href={blog.link.href}>{blog.link.label}</Link>
      {blog.translations?.length > 0 && (
        <p>
          {translations[locale]?.translationCanBeFound}
          {blog.translations.map((translation) => (
            <Link key={translation} href={translation}>
              {translation}
            </Link>
          ))}
        </p>
      )}
      s
    </div>
  );
}
