import * as ExpoCrypto from "expo-crypto";

type CryptoGlobal = typeof globalThis & { crypto?: Crypto };

const runtime = globalThis as CryptoGlobal;
const currentCrypto = runtime.crypto;

if (!currentCrypto?.randomUUID || !currentCrypto.getRandomValues) {
  const cryptoShim = Object.create(currentCrypto ?? null) as Crypto;
  if (!currentCrypto?.randomUUID) {
    Object.defineProperty(cryptoShim, "randomUUID", { value: ExpoCrypto.randomUUID });
  }
  if (!currentCrypto?.getRandomValues) {
    Object.defineProperty(cryptoShim, "getRandomValues", { value: ExpoCrypto.getRandomValues });
  }
  Object.defineProperty(runtime, "crypto", {
    configurable: true,
    enumerable: true,
    writable: true,
    value: cryptoShim,
  });
}
