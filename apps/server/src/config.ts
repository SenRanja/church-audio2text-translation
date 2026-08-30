import { z } from "zod";

const integerFromEnv = (fallback: number) =>
  z.coerce.number().int().positive().default(fallback);
const activeSessionsFromEnv = z.coerce.number().int().min(1).max(100).default(10);

const configSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  DEEPGRAM_API_KEY: z.string().default(""),
  OPENAI_API_KEY: z.string().default(""),
  DEEPGRAM_MODEL: z.string().default("nova-3"),
  OPENAI_MODEL: z.string().default("gpt-4o-mini-2024-07-18"),
  ALLOWED_ORIGINS: z.string().default("http://localhost:5173,http://localhost:3000"),
  MAX_ACTIVE_SESSIONS: activeSessionsFromEnv,
  MAX_SESSION_MINUTES: integerFromEnv(180),
  PORT: integerFromEnv(3000),
  AUTH_DB_PATH: z.string().default("data/auth.sqlite"),
  AUTH_COOKIE_SECURE: z.enum(["true", "false"]).default("false"),
  LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"]).default("info"),
});

export type AppConfig = ReturnType<typeof loadConfig>;

export function loadConfig(environment: NodeJS.ProcessEnv = process.env) {
  const parsed = configSchema.parse(environment);

  return {
    nodeEnv: parsed.NODE_ENV,
    deepgramApiKey: parsed.DEEPGRAM_API_KEY,
    openAiApiKey: parsed.OPENAI_API_KEY,
    deepgramModel: parsed.DEEPGRAM_MODEL,
    openAiModel: parsed.OPENAI_MODEL,
    allowedOrigins: parsed.ALLOWED_ORIGINS.split(",").map((origin) => origin.trim()),
    maxActiveSessions: parsed.MAX_ACTIVE_SESSIONS,
    maxSessionMinutes: parsed.MAX_SESSION_MINUTES,
    port: parsed.PORT,
    authDatabasePath: parsed.AUTH_DB_PATH,
    authCookieSecure: parsed.AUTH_COOKIE_SECURE === "true",
    logLevel: parsed.LOG_LEVEL,
    isConfigured: Boolean(parsed.DEEPGRAM_API_KEY && parsed.OPENAI_API_KEY),
  };
}