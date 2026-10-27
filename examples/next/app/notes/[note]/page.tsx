import { fetchValRoute } from "../../../val/rsc";
import notesVal from "./page.val";

/**
 * A server component reading a plain router.
 *
 * No `suspend` involved: this resolves on the server, where draft content comes
 * from the patches the server itself can read. So this is the other half of the
 * "can I see a page I have not committed" question — the client half is
 * `/blogs/[blog]`.
 */
export default async function NotePage({
  params,
}: {
  params: Promise<{ note: string }>;
}) {
  const note = await fetchValRoute(notesVal, params);
  if (!note) {
    return <main>Note not found.</main>;
  }
  return (
    <main>
      <h1>{note.title}</h1>
      <p>{note.body}</p>
    </main>
  );
}
