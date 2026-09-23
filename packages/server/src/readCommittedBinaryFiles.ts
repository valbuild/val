/**
 * The bytes of the local binary files a commit is about to write, base64.
 *
 * For the Studio's in-tab build of a managed project, which publishes the site:
 * an image uploaded in this save is in no earlier build, so unless the build
 * is given it the published page links a file that 404s. Remote files are left
 * out -- they are served from their own URL and never were part of a build.
 *
 * A file that cannot be read is NAMED rather than dropped, and does not stop
 * the save: the commit is what makes an edit durable, and the build is the
 * step that can refuse.
 *
 * Read BEFORE the commit, because after it the files are no longer the
 * patch's to read. Generic over the patch id so it asks for exactly the one
 * method it uses, and a test can hand it a plain object.
 */
export async function readCommittedBinaryFiles<Id>(
  ops: {
    getBase64EncodedBinaryFileFromPatch(
      filePath: string,
      patchId: Id,
      remote: boolean,
    ): Promise<Buffer | null>;
  },
  descriptors: Record<string, { patchId: Id; remote: boolean }>,
): Promise<{ files: Record<string, string>; unread: string[] }> {
  const files: Record<string, string> = {};
  const unread: string[] = [];
  await Promise.all(
    Object.entries(descriptors).map(async ([filePath, { patchId, remote }]) => {
      if (remote) return;
      const bytes = await ops
        .getBase64EncodedBinaryFileFromPatch(filePath, patchId, remote)
        .catch((error: unknown) => {
          console.error("Could not read a committed file", filePath, error);
          return null;
        });
      if (bytes === null) unread.push(filePath);
      else files[filePath] = bytes.toString("base64");
    }),
  );
  return { files, unread: unread.sort() };
}
