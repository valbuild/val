/** The proposal's project: the site's source, with what the proposal changed laid over it. */
export function proposalProject(
  site: Record<string, string>,
  own: Record<string, string | null>,
): Record<string, string> {
  const out = { ...site };
  for (const [path, text] of Object.entries(own)) {
    if (text === null) delete out[path];
    else out[path] = text;
  }
  return out;
}
