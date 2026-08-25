/**
 * A byte count as an editor would say it.
 *
 * Decimal units, because that is what an operating system's file listing
 * shows and the number here should match the one someone sees next to the
 * file they just picked.
 */
export function formatBytes(bytes: number): string {
  if (bytes < 1000) {
    return `${bytes} B`;
  }
  const units = ["kB", "MB", "GB"];
  let value = bytes / 1000;
  let unit = 0;
  while (value >= 1000 && unit < units.length - 1) {
    value /= 1000;
    unit += 1;
  }
  // One decimal below 10, none above: "1.9 MB" is worth knowing, "13.0 MB" is
  // not.
  return `${value < 10 ? value.toFixed(1) : Math.round(value)} ${units[unit]}`;
}

/** A mime type as the short label a grid tile has room for. */
export function fileTypeLabel(mimeType: string): string {
  const known: Record<string, string> = {
    "application/pdf": "PDF",
    "application/zip": "ZIP",
    "text/plain": "TXT",
    "text/csv": "CSV",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document":
      "DOCX",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": "XLSX",
    "application/vnd.openxmlformats-officedocument.presentationml.presentation":
      "PPTX",
  };
  if (known[mimeType]) {
    return known[mimeType];
  }
  const subtype = mimeType.split("/")[1] ?? mimeType;
  return subtype.slice(0, 4).toUpperCase();
}
