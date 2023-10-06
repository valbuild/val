export const getSHA256Hash = async (bits: Uint8Array) => {
  const hashBuffer = await crypto.subtle.digest("SHA-256", bits);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  const hash = hashArray
    .map((item) => item.toString(16).padStart(2, "0"))
    .join("");
  return hash;
};
