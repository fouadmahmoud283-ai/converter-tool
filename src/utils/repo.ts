export function repoNameFromUrl(url: string): string {
  const trimmed = url.replace(/\/$/, '');
  const lastSegment = trimmed.split('/').pop() ?? 'repo';
  return lastSegment.replace(/\.git$/, '') || 'repo';
}
