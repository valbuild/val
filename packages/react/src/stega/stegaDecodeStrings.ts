import { vercelStegaDecodeAll } from "@vercel/stega";

export function stegaDecodeStrings(
  encodedString: unknown,
): string[] | undefined {
  if (!encodedString || typeof encodedString !== "string") return;
  const encodedBits = vercelStegaDecodeAll(encodedString);
  const paths: string[] = [];
  if (!encodedBits) return;
  for (const encodedBit of encodedBits) {
    if (encodedBit && typeof encodedBit === "object") {
      if (
        "origin" in encodedBit &&
        "data" in encodedBit &&
        typeof encodedBit.data === "object" &&
        encodedBit.data &&
        "valPath" in encodedBit.data &&
        typeof encodedBit.data.valPath === "string"
      ) {
        paths.push(encodedBit.data.valPath);
      }
    }
  }
  return paths.length > 0 ? paths : undefined;
}
