/**
 * Converts a base64 data URL to a Uint8Array.
 * This is a browser-compatible replacement for Node.js Buffer.from().
 *
 * @param dataUrl - A data URL string (e.g., "data:image/png;base64,iVBORw0KG...")
 * @returns A Uint8Array containing the decoded binary data
 */
export function base64DataUrlToUint8Array(dataUrl: string): Uint8Array {
  // Extract the base64 string from the data URL (everything after the comma)
  const base64String = dataUrl.split(",")[1];
  // Decode base64 to binary string
  const binaryString = atob(base64String);
  // Convert binary string to Uint8Array
  const binaryData = new Uint8Array(binaryString.length);
  for (let i = 0; i < binaryString.length; i++) {
    binaryData[i] = binaryString.charCodeAt(i);
  }
  return binaryData;
}
