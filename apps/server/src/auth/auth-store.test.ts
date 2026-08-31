import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import Database from "better-sqlite3";
import { afterEach, describe, expect, it } from "vitest";

import { AuthStore } from "./auth-store";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

describe("AuthStore persistence", () => {
  it("seeds the admin and keeps managed users across restarts", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "church-auth-"));
    temporaryDirectories.push(directory);
    const databasePath = path.join(directory, "auth.sqlite");

    const first = await AuthStore.open(databasePath);
    expect(await first.verifyCredentials("FOCUS-Jayd", "FOCUS-Jayd")).toEqual(
      expect.objectContaining({ username: "FOCUS-Jayd", role: "admin", isSeed: true }),
    );
    await first.createUser("persistent-user", "persistent-password");
    first.close();

    const reopened = await AuthStore.open(databasePath);
    expect(await reopened.verifyCredentials("persistent-user", "persistent-password")).toEqual(
      expect.objectContaining({ username: "persistent-user", role: "user", isSeed: false }),
    );
    expect(reopened.listUsers()).toHaveLength(2);
    reopened.close();
  });

  it("persists session settings and can limit a user to one terminal", async () => {
    const store = await AuthStore.open(":memory:");
    const admin = await store.verifyCredentials("FOCUS-Jayd", "FOCUS-Jayd");
    expect(admin).not.toBeNull();

    expect(store.getSettings()).toEqual({
      sessionLifetimeHours: 12,
    });
    store.updateSettings({ sessionLifetimeHours: 24 });

    const first = store.createSession(admin!.id);
    const second = store.createSession(admin!.id);
    expect(first.maxAgeSeconds).toBe(24 * 60 * 60);
    expect(store.getSessionUser(first.token)).toBeNull();
    expect(store.getSessionUser(second.token)?.id).toBe(admin!.id);
    store.close();
  });

  it("persists the church default but clears a user's custom prompt on login", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "church-auth-prompt-"));
    temporaryDirectories.push(directory);
    const databasePath = path.join(directory, "auth.sqlite");
    const store = await AuthStore.open(databasePath);
    const user = await store.createUser("prompt-user", "persistent-password");
    store.updateDefaultPrompt("Church default prompt");
    const first = store.createSession(user.id);
    expect(store.updateSessionPrompt(first.token, "Temporary custom prompt")).toBe(true);
    expect(store.getSessionUser(first.token)?.customPrompt).toBe("Temporary custom prompt");

    const second = store.createSession(user.id);
    expect(store.getSessionUser(first.token)).toBeNull();
    expect(store.getSessionUser(second.token)?.customPrompt).toBe("");
    store.close();

    const reopened = await AuthStore.open(databasePath);
    expect(reopened.getDefaultPrompt()).toBe("Church default prompt");
    reopened.close();
  });

  it("migrates the seed admin's legacy prompt to the church default", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "church-auth-legacy-prompt-"));
    temporaryDirectories.push(directory);
    const databasePath = path.join(directory, "auth.sqlite");
    const store = await AuthStore.open(databasePath);
    store.close();

    const database = new Database(databasePath);
    database.prepare("UPDATE users SET custom_prompt = ? WHERE username = ?")
      .run("Legacy admin prompt", "FOCUS-Jayd");
    database.close();

    const reopened = await AuthStore.open(databasePath);
    expect(reopened.getDefaultPrompt()).toBe("Legacy admin prompt");
    reopened.close();
  });
});