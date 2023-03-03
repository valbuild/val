export function getFileIdFromParams(params: { 0: string }): string {
  return `/${params[0]}`;
}
