import sealedbox from 'tweetnacl-sealedbox-js';

/**
 * 使用 GitHub Actions 公钥执行 libsodium sealed box 加密。
 * 加密后的值只能由 GitHub 解密，应用无法回读 Secret 明文。
 */
export function encryptGitHubSecretValue(value: string, publicKeyBase64: string): string {
  const normalized = publicKeyBase64.replace(/\s+/g, '');
  const binary = atob(normalized);
  const publicKey = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    publicKey[index] = binary.charCodeAt(index);
  }

  const sealed = sealedbox.seal(new TextEncoder().encode(value), publicKey);
  let encoded = '';
  for (const byte of sealed) {
    encoded += String.fromCharCode(byte);
  }
  return btoa(encoded);
}