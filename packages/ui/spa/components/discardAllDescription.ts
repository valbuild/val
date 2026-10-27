/**
 * What discarding everything costs, in a sentence.
 *
 * `otherAuthorNames` is everyone whose work this would take *except you* — the
 * caller filters itself out, because in a shared project Discard all takes work
 * that is not yours and finding that out afterwards is not a thing this view
 * should let happen. One other person is already the whole point, so one name is
 * enough to trigger the clause; two names at most, because a list of nine is a
 * list nobody reads.
 *
 * Its own module because the plural agreement and the comma between the names are
 * the sort of thing that only ever gets checked by reading it out loud — so it is
 * tested, and `ComparePatchSets` cannot be imported from a test: it reaches a
 * worker through `import.meta.url`, which jest cannot load.
 */
export function discardAllDescription(
  count: number,
  otherAuthorNames: string[],
): string {
  const clause =
    count === 1
      ? "1 unpublished change in this project goes away"
      : `All ${count} unpublished changes in this project go away`;
  if (otherAuthorNames.length > 0) {
    const shown = otherAuthorNames.slice(0, 2);
    const rest = otherAuthorNames.length - shown.length;
    const names =
      rest > 0
        ? `${shown.join(", ")} and ${rest} ${rest === 1 ? "other" : "others"}`
        : shown.join(" and ");
    return `${clause} — including changes made by ${names}. This cannot be undone.`;
  }
  return `${clause}. This cannot be undone.`;
}
