import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import cookiePlugin from "@fastify/cookie";
import rateLimitPlugin from "@fastify/rate-limit";
import staticPlugin from "@fastify/static";
import websocketPlugin from "@fastify/websocket";
import { clientMessageSchema, type ServerMessage } from "@church/contracts";
import Fastify, { LogController } from "fastify";
import type WebSocket from "ws";
import { z } from "zod";

import { AuthStore, type AuthUser } from "./auth/auth-store";
import type { AppConfig } from "./config";
import { LiveSession } from "./sessions/live-session";
import { SourceTranscriptWriter } from "./transcripts/source-transcript-writer";

export async function buildServer(config: AppConfig) {
  const moduleDirectory = path.dirname(fileURLToPath(import.meta.url));
  const logDirectory = path.resolve(moduleDirectory, "../../../log");
  const app = Fastify({
    logger: {
      level: config.logLevel,
      redact: ["req.headers.authorization", "req.headers.cookie", "deepgramApiKey", "openAiApiKey"],
      timestamp: () => `,"timestamp":"${new Date().toISOString()}"`,
    },
    logController: new LogController({ disableRequestLogging: true }),
    bodyLimit: 32_768,
  });
  const sessions = new Set<LiveSession>();
  const authStore = await AuthStore.open(config.authDatabasePath);

  await app.register(cookiePlugin);
  await app.register(websocketPlugin, { options: { maxPayload: 1_000_000 } });
  await app.register(rateLimitPlugin, { global: false });

  app.addHook("onClose", () => authStore.close());

  app.get("/health/live", async () => ({ status: "ok" }));
  app.get("/health/ready", async (_request, reply) => {
    if (!config.isConfigured) return reply.code(503).send({ status: "missing_api_keys" });
    return { status: "ready" };
  });

  const loginSchema = z.object({
    username: z.string().trim().min(1).max(64),
    password: z.string().min(1).max(128),
  });
  const createUserSchema = z.object({
    username: z.string().trim().min(3).max(64).regex(/^[\p{L}\p{N}._@-]+$/u),
    password: z.string().min(8).max(128),
  });
  const userParamsSchema = z.object({ id: z.string().uuid() });

  app.post(
    "/api/auth/login",
    { config: { rateLimit: { max: 10, timeWindow: "1 minute" } } },
    async (request, reply) => {
      if (!isAllowedOrigin(request.headers.origin, request.headers.host, config.allowedOrigins)) {
        return reply.code(403).send({ error: "ERROR" });
      }
      const credentials = loginSchema.safeParse(request.body);
      const user = credentials.success
        ? await authStore.verifyCredentials(credentials.data.username, credentials.data.password)
        : null;
      if (!user) {
        request.log.warn({ event: "auth.login.failed" }, "auth.login.failed");
        return reply.code(401).send({ error: "ERROR" });
      }
      const token = authStore.createSession(user.id);
      reply.setCookie("church_session", token, sessionCookieOptions(config));
      return { user: publicUser(user) };
    },
  );

  app.get("/api/auth/me", async (request, reply) => {
    const user = authStore.getSessionUser(request.cookies?.church_session);
    return { user: user ? publicUser(user) : null };
  });

  app.post("/api/auth/logout", async (request, reply) => {
    if (!isAllowedOrigin(request.headers.origin, request.headers.host, config.allowedOrigins)) {
      return reply.code(403).send({ error: "ERROR" });
    }
    authStore.destroySession(request.cookies?.church_session);
    reply.clearCookie("church_session", { path: "/" });
    return { ok: true };
  });

  app.get("/api/admin/users", async (request, reply) => {
    const user = requireAdmin(request.cookies?.church_session, authStore);
    if (!user) return reply.code(403).send({ error: "ERROR" });
    return { users: authStore.listUsers().map(publicUser) };
  });

  app.post("/api/admin/users", async (request, reply) => {
    const admin = requireAdmin(request.cookies?.church_session, authStore);
    const input = createUserSchema.safeParse(request.body);
    if (!admin || !input.success || !isAllowedOrigin(request.headers.origin, request.headers.host, config.allowedOrigins)) {
      return reply.code(400).send({ error: "ERROR" });
    }
    try {
      const user = await authStore.createUser(input.data.username, input.data.password);
      return reply.code(201).send({ user: publicUser(user) });
    } catch {
      return reply.code(409).send({ error: "ERROR" });
    }
  });

  app.delete("/api/admin/users/:id", async (request, reply) => {
    const admin = requireAdmin(request.cookies?.church_session, authStore);
    const params = userParamsSchema.safeParse(request.params);
    if (!admin || !params.success || !isAllowedOrigin(request.headers.origin, request.headers.host, config.allowedOrigins)) {
      return reply.code(400).send({ error: "ERROR" });
    }
    if (!authStore.deleteUser(params.data.id)) return reply.code(409).send({ error: "ERROR" });
    return { ok: true };
  });

  app.get(
    "/ws/session",
    {
      websocket: true,
      config: {
        rateLimit: {
          max: Math.max(30, config.maxActiveSessions * 3),
          timeWindow: "1 minute",
        },
      },
    },
    (socket, request) => {
    if (!authStore.getSessionUser(request.cookies?.church_session)) {
      sendError(socket, "AUTH_REQUIRED", "Authentication required.", false);
      return socket.close(1008, "Authentication required");
    }
    if (!isAllowedOrigin(request.headers.origin, request.headers.host, config.allowedOrigins)) {
      sendError(socket, "ORIGIN_NOT_ALLOWED", "This page is not allowed to start translation.", false);
      return socket.close(1008, "Origin not allowed");
    }

    if (sessions.size >= config.maxActiveSessions) {
      sendError(socket, "SESSION_LIMIT", "The server has reached its active session limit. Try again later.", true);
      return socket.close(1013, "Session limit reached");
    }

    let session: LiveSession;
    const removeSession = () => sessions.delete(session);
    const sourceTranscript = new SourceTranscriptWriter(logDirectory, (error) => {
      app.log.error({ event: "source.transcript.error", error }, "source.transcript.error");
    });
    session = new LiveSession(socket, config, removeSession, (event, details = {}) => {
      const log = event.endsWith(".error") ? app.log.error.bind(app.log) : app.log.debug.bind(app.log);
      log({ event, sessionId: session.id, ...details }, event);
    }, sourceTranscript);
    sessions.add(session);

    socket.on("message", (data, isBinary) => {
      if (isBinary) {
        session.handleAudio(Buffer.from(data as Buffer));
        return;
      }

      try {
        const message = clientMessageSchema.parse(JSON.parse(data.toString()));
        void session.handleControl(message);
      } catch {
        sendError(socket, "INVALID_MESSAGE", "The server received an invalid control message.", true);
      }
    });
    socket.on("close", () => session.disconnect());
    socket.on("error", () => session.disconnect());
    },
  );

  const webRoot = path.resolve(moduleDirectory, "../../web/dist");
  if (existsSync(webRoot)) {
    await app.register(staticPlugin, { root: webRoot, wildcard: false });
  }
  app.setNotFoundHandler((request, reply) => {
    if (
      request.raw.url?.startsWith("/api/") ||
      request.raw.url?.startsWith("/ws/") ||
      request.raw.url?.startsWith("/health/")
    ) {
      return reply.code(404).send({ error: "Not found" });
    }
    if (existsSync(webRoot)) return reply.sendFile("index.html");
    return reply.code(404).send({ error: "Frontend is running on the Vite development server" });
  });

  return app;
}

function requireAdmin(token: string | undefined, authStore: AuthStore) {
  const user = authStore.getSessionUser(token);
  return user?.role === "admin" ? user : null;
}

function publicUser(user: AuthUser) {
  return {
    id: user.id,
    username: user.username,
    role: user.role,
    isSeed: user.isSeed,
    createdAt: user.createdAt,
  };
}

function sessionCookieOptions(config: AppConfig) {
  return {
    path: "/",
    httpOnly: true,
    sameSite: "strict" as const,
    secure: config.authCookieSecure,
    maxAge: 12 * 60 * 60,
  };
}

function isAllowedOrigin(origin: string | undefined, host: string | undefined, allowed: string[]) {
  if (!origin) return false;
  if (allowed.includes(origin)) return true;

  try {
    return new URL(origin).host === host;
  } catch {
    return false;
  }
}

function sendError(socket: WebSocket, code: string, message: string, recoverable: boolean) {
  const event: ServerMessage = { type: "error", code, message, recoverable };
  if (socket.readyState === socket.OPEN) socket.send(JSON.stringify(event));
}