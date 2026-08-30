import type { IncomingMessage } from "node:http";

import { afterEach, describe, expect, it, vi } from "vitest";
import type WebSocket from "ws";

import { loadConfig } from "./config";
import { buildServer } from "./server";

const sessions = vi.hoisted(() => ({ active: 0, created: 0 }));

vi.mock("./sessions/live-session", () => ({
  LiveSession: class {
    readonly id = `session-${++sessions.created}`;
    private closed = false;

    constructor(
      _socket: WebSocket,
      _config: unknown,
      private readonly onClosed: () => void,
    ) {
      sessions.active += 1;
    }

    handleAudio() {}
    async handleControl() {}

    disconnect() {
      if (this.closed) return;
      this.closed = true;
      sessions.active -= 1;
      this.onClosed();
    }
  },
}));

afterEach(() => {
  sessions.active = 0;
  sessions.created = 0;
});

function sessionCookie(setCookie: string | string[] | undefined) {
  const value = Array.isArray(setCookie) ? setCookie[0] : setCookie;
  return value?.split(";")[0];
}

describe("WebSocket session capacity", () => {
  it("isolates active sessions, rejects overflow, and releases closed slots", async () => {
    const app = await buildServer(
      loadConfig({
        DEEPGRAM_API_KEY: "test-deepgram-key",
        OPENAI_API_KEY: "test-openai-key",
        MAX_ACTIVE_SESSIONS: "2",
        AUTH_DB_PATH: ":memory:",
        LOG_LEVEL: "silent",
      }),
    );
    await app.ready();
    const login = await app.inject({
      method: "POST",
      url: "/api/auth/login",
      headers: { origin: "http://localhost:3000" },
      payload: { username: "FOCUS-Jayd", password: "FOCUS-Jayd" },
    });
    const cookie = sessionCookie(login.headers["set-cookie"]);
    const upgrade = {
      headers: { origin: "http://localhost:3000", cookie },
      socket: { remoteAddress: "203.0.113.10" },
    } as unknown as Partial<IncomingMessage>;
    const sockets: WebSocket[] = [];

    try {
      sockets.push(await app.injectWS("/ws/session", upgrade));
      sockets.push(await app.injectWS("/ws/session", upgrade));
      expect(sessions.active).toBe(2);
      expect(sessions.created).toBe(2);

      const overflow = await app.injectWS("/ws/session", upgrade);
      sockets.push(overflow);
      await vi.waitFor(() => expect(overflow.readyState).toBe(overflow.CLOSED));
      expect(sessions.active).toBe(2);
      expect(sessions.created).toBe(2);

      sockets[0]?.terminate();
      await vi.waitFor(() => expect(sessions.active).toBe(1));

      sockets.push(await app.injectWS("/ws/session", upgrade));
      expect(sessions.active).toBe(2);
      expect(sessions.created).toBe(3);
    } finally {
      sockets.forEach((socket) => socket.terminate());
      await app.close();
    }
  });
});

describe("authentication", () => {
  it("uses generic login errors and restricts account management to admins", async () => {
    const app = await buildServer(
      loadConfig({
        DEEPGRAM_API_KEY: "test-deepgram-key",
        OPENAI_API_KEY: "test-openai-key",
        AUTH_DB_PATH: ":memory:",
        LOG_LEVEL: "silent",
      }),
    );
    await app.ready();
    const origin = { origin: "http://localhost:3000" };

    try {
      const unknownUser = await app.inject({
        method: "POST",
        url: "/api/auth/login",
        headers: origin,
        payload: { username: "missing", password: "incorrect" },
      });
      const wrongPassword = await app.inject({
        method: "POST",
        url: "/api/auth/login",
        headers: origin,
        payload: { username: "FOCUS-Jayd", password: "incorrect" },
      });
      expect(unknownUser.statusCode).toBe(401);
      expect(wrongPassword.statusCode).toBe(401);
      expect(unknownUser.json()).toEqual({ error: "ERROR" });
      expect(wrongPassword.json()).toEqual({ error: "ERROR" });

      const adminLogin = await app.inject({
        method: "POST",
        url: "/api/auth/login",
        headers: origin,
        payload: { username: "FOCUS-Jayd", password: "FOCUS-Jayd" },
      });
      const adminCookie = sessionCookie(adminLogin.headers["set-cookie"]);
      expect(adminLogin.statusCode).toBe(200);

      const created = await app.inject({
        method: "POST",
        url: "/api/admin/users",
        headers: { ...origin, cookie: adminCookie },
        payload: { username: "translator", password: "secure-pass" },
      });
      expect(created.statusCode).toBe(201);

      const userLogin = await app.inject({
        method: "POST",
        url: "/api/auth/login",
        headers: origin,
        payload: { username: "translator", password: "secure-pass" },
      });
      const userCookie = sessionCookie(userLogin.headers["set-cookie"]);
      const forbidden = await app.inject({
        method: "GET",
        url: "/api/admin/users",
        headers: { cookie: userCookie },
      });
      expect(userLogin.statusCode).toBe(200);
      expect(forbidden.statusCode).toBe(403);

      const users = await app.inject({
        method: "GET",
        url: "/api/admin/users",
        headers: { cookie: adminCookie },
      });
      expect(users.json().users).toEqual([
        expect.objectContaining({ username: "FOCUS-Jayd", role: "admin", isSeed: true }),
        expect.objectContaining({ username: "translator", role: "user", isSeed: false }),
      ]);

      const seedId = users.json().users[0].id;
      const seedDelete = await app.inject({
        method: "DELETE",
        url: `/api/admin/users/${seedId}`,
        headers: { ...origin, cookie: adminCookie },
      });
      expect(seedDelete.statusCode).toBe(409);

      const userId = created.json().user.id;
      const deleted = await app.inject({
        method: "DELETE",
        url: `/api/admin/users/${userId}`,
        headers: { ...origin, cookie: adminCookie },
      });
      const deletedSession = await app.inject({
        method: "GET",
        url: "/api/auth/me",
        headers: { cookie: userCookie },
      });
      expect(deleted.statusCode).toBe(200);
      expect(deletedSession.json()).toEqual({ user: null });
    } finally {
      await app.close();
    }
  });

  it("rejects an unauthenticated WebSocket", async () => {
    const app = await buildServer(
      loadConfig({ AUTH_DB_PATH: ":memory:", LOG_LEVEL: "silent" }),
    );
    await app.ready();
    const socket = await app.injectWS("/ws/session", {
      headers: { origin: "http://localhost:3000" },
      socket: { remoteAddress: "203.0.113.20" },
    } as unknown as Partial<IncomingMessage>);

    try {
      await vi.waitFor(() => expect(socket.readyState).toBe(socket.CLOSED));
      expect(sessions.created).toBe(0);
    } finally {
      socket.terminate();
      await app.close();
    }
  });
});
