export function fromCamelToTitleCase(text: string): string {
  const result = text.replace(/([A-Z])/g, " $1").toLowerCase();
  return result.charAt(0).toUpperCase() + result.slice(1);
}
