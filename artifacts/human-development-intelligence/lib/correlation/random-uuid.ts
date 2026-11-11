/** Web/Node platform UUID source. No fallback is permitted. */
export function randomUuid(): string {
  const cryptoValue = globalThis.crypto;
  if (!cryptoValue || typeof cryptoValue.randomUUID !== 'function') {
    throw Error('SESSION_CORRELATION_UUID_UNAVAILABLE');
  }
  return cryptoValue.randomUUID();
}
