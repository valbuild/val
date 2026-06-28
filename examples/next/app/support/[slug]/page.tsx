import { fetchValKey } from "../../../val/rsc";
import supportVal from "./page.val";

export default async function SupportPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  // Loads ONLY this slug's backing *.val.json (one dynamic import), not the
  // whole support-pages record.
  const page = await fetchValKey(supportVal, `/support/${slug}`);
  if (!page) {
    return <main>Support page not found.</main>;
  }
  return (
    <main>
      <h1>{page.title}</h1>
      <p>{page.body}</p>
    </main>
  );
}
