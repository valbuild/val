import { fetchValRoute } from "../../../val/rsc";
import pageVal from "./page.val";

export default async function GenericPage({
  params,
}: {
  params: { path: string[] };
}) {
  const content = await fetchValRoute(pageVal, params);
  return (
    <main>
      <h1>{content?.title}</h1>
      <p>{content?.content}</p>
    </main>
  );
}
