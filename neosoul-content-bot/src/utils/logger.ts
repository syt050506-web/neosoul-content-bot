const formatMessage = (level: string, message: string): string =>
  `[${new Date().toISOString()}] [${level}] ${message}`;

export const logger = {
  info(message: string): void {
    console.info(formatMessage('INFO', message));
  },
  warn(message: string): void {
    console.warn(formatMessage('WARN', message));
  },
  error(message: string, error?: unknown): void {
    console.error(formatMessage('ERROR', message), error ?? '');
  },
};
