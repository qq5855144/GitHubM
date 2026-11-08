declare module 'tweetnacl-sealedbox-js' {
  interface SealedBox {
    seal(message: Uint8Array, publicKey: Uint8Array): Uint8Array;
    open(sealed: Uint8Array, publicKey: Uint8Array, secretKey: Uint8Array): Uint8Array | null;
  }

  const sealedbox: SealedBox;
  export default sealedbox;
  export function seal(message: Uint8Array, publicKey: Uint8Array): Uint8Array;
  export function open(
    sealed: Uint8Array,
    publicKey: Uint8Array,
    secretKey: Uint8Array,
  ): Uint8Array | null;
}