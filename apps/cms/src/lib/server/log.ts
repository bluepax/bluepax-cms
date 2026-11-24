// Structured JSON logs, see docs/spec/README.md chapter 9 ("备份与可观测").
type Level = 'debug' | 'info' | 'warn' | 'error';

export function log(level: Level, message: string, fields: Record<string, unknown> = {}): void {
  const line = JSON.stringify({ time: new Date().toISOString(), level, message, ...fields });
  if (level === 'error' || level === 'warn') console.error(line);
  else console.log(line);
}
