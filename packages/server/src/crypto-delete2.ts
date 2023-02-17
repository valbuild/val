// TODO: delete tweetnacl and use this instead. tweetnacl needs Crypto which is not in edge

import { secretbox, randomBytes } from "tweetnacl-ts";
import {
  decodeUTF8,
  encodeUTF8,
  encodeBase64,
  decodeBase64,
} from "tweetnacl-util";

// TODO: use BoxLength from tweetnacl-ts
const BoxLength = {
  PublicKey: 32,
  SecretKey: 32,
  SharedKey: 32,
  Nonce: 24,
  Overhead: 16,
};
const newNonce = () => randomBytes(BoxLength.Nonce);

export const generateKey = () => encodeBase64(randomBytes(BoxLength.SecretKey));

export const encrypt = (json: object, key: string) => {
  const keyUint8Array = decodeBase64(key);

  const nonce = newNonce();
  const messageUint8 = decodeUTF8(JSON.stringify(json));
  const box = secretbox(messageUint8, nonce, keyUint8Array);

  const fullMessage = new Uint8Array(nonce.length + box.length);
  fullMessage.set(nonce);
  fullMessage.set(box, nonce.length);

  const base64FullMessage = encodeBase64(fullMessage);
  return base64FullMessage;
};

export const decrypt = (
  messageWithNonce: string,
  key: string
): { success: null; error: string } | { success: unknown; error: null } => {
  const keyUint8Array = decodeBase64(key);
  const messageWithNonceAsUint8Array = decodeBase64(messageWithNonce);
  const nonce = messageWithNonceAsUint8Array.slice(0, BoxLength.Nonce);
  const message = messageWithNonceAsUint8Array.slice(
    BoxLength.Nonce,
    messageWithNonce.length
  );
  const decrypted = secretbox(message, nonce, keyUint8Array);

  if (!decrypted) {
    return { success: null, error: "Could not decrypt message" };
  }

  const base64DecryptedMessage = encodeUTF8(decrypted);
  return { success: JSON.parse(base64DecryptedMessage), error: null };
};
