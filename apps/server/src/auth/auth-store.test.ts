import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

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
});