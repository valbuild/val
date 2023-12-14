import { vercelStegaDecode } from "@vercel/stega";

export function stegaDecodeString(encodedString: string): string | undefined {
  const encodedBits = vercelStegaDecode(encodedString);
  if (encodedBits && typeof encodedBits === "object") {
    if (
      "origin" in encodedBits &&
      "data" in encodedBits &&
      typeof encodedBits.data === "object" &&
      encodedBits.data &&
      "valPath" in encodedBits.data &&
      typeof encodedBits.data.valPath === "string"
    ) {
      return encodedBits.data.valPath;
    }
  }
}
