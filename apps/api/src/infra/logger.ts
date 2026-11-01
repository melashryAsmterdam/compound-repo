import pino from 'pino';

/** PII redaction (standards: pino with PII redaction). */
export const logger = pino({
  level: process.env.LOG_LEVEL ?? (process.env.NODE_ENV === 'test' ? 'silent' : 'info'),
  redact: {
    paths: ['*.phone', '*.phone_e164', '*.email', '*.full_name', '*.fullName', '*.code', '*.password', '*.token', '*.destination', '*.body', '*.description', 'req.headers.cookie', 'req.headers.authorization'],
    censor: '[redacted]',
  },
});
