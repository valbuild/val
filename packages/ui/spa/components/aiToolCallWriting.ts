/**
 * What to say a call is about, from the arguments the content service has
 * seen so far (`ai_tool_call_progress`): the path of a file, or the files of
 * a `write_files`. Undefined when nothing short says it.
 */
export function toolCallDetail(progress: {
  arguments?: Record<string, string>;
  keys?: Record<string, string[]>;
}): string | undefined {
  const path = progress.arguments?.["path"];
  if (path) return path;
  const files = progress.keys?.["files"] ?? [];
  if (files.length === 0) return undefined;
  return files.length === 1
    ? files[0]
    : `${files[0]} and ${files.length - 1} more`;
}
