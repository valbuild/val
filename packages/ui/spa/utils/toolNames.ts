export const toolNames = [
  "get_all_schema",
  "get_source",
  "search_content",
  "validate_content",
  "create_patch",
  "navigate_to",
  "get_current_context",
  "get_patches",
  "get_source_path_from_route",
  "set_session_name",
] as const;
export type ToolName = (typeof toolNames)[number];
