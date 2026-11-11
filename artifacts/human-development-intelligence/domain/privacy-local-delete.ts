export type LocalDeleteResult = 'confirmed' | 'failed' | 'partial';

export function summarizeLocalDeleteResults(results: readonly boolean[]): LocalDeleteResult {
  const succeeded = results.filter(Boolean).length;
  if (results.length > 0 && succeeded === results.length) return 'confirmed';
  return succeeded === 0 ? 'failed' : 'partial';
}
