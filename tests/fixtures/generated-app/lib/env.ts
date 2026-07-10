// Environment parsing placeholder.
// Use a validated accessor here; do not read secrets casually.
export function getEnv(key: string, fallback?: string): string | undefined {
  return process.env[key] ?? fallback;
}
