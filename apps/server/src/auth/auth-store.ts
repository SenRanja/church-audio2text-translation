import { createHash, randomBytes, randomUUID, scrypt as scryptCallback, timingSafeEqual } from "node:crypto";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import Database from "better-sqlite3";

const scrypt = promisify(scryptCallback);
const seedUsername = "FOCUS-Jayd";
const seedPassword = "FOCUS-Jayd";
const defaultSessionLifetimeHours = 12;

export interface AuthSettings {
  sessionLifetimeHours: number;
}

export interface AuthUser {
  id: string;
  username: string;
  role: "admin" | "user";
  isSeed: boolean;
  createdAt: number;
  customPrompt: string;
}

interface UserRow {
  id: string;
  username: string;
  password_hash: string;
  role: "admin" | "user";
  is_seed: number;
  created_at: number;
  custom_prompt: string;
}

interface SettingsRow {
  session_lifetime_hours: number;
}

export class AuthStore {
  private dummyPasswordHash = "";

  private constructor(private readonly database: Database.Database) {}

  static async open(databasePath: string) {
    if (databasePath !== ":memory:") await mkdir(path.dirname(databasePath), { recursive: true });
    const store = new AuthStore(new Database(databasePath));
    store.initialize();
    await store.seedAdmin();
    store.dummyPasswordHash = await hashPassword(randomBytes(24).toString("base64url"));
    return store;
  }

  close() {
    this.database.close();
  }

  async verifyCredentials(username: string, password: string) {
    const row = this.database
      .prepare("SELECT * FROM users WHERE username = ? COLLATE NOCASE")
      .get(username) as unknown as UserRow | undefined;
    const valid = await verifyPassword(password, row?.password_hash ?? this.dummyPasswordHash);
    return row && valid ? toAuthUser(row) : null;
  }

  createSession(userId: string) {
    const token = randomBytes(32).toString("base64url");
    const now = Date.now();
    const settings = this.getSettings();
    const lifetimeMs = settings.sessionLifetimeHours * 60 * 60 * 1_000;
    this.database.prepare("DELETE FROM sessions WHERE expires_at <= ?").run(now);
    this.database.prepare("DELETE FROM sessions WHERE user_id = ?").run(userId);
    this.database
      .prepare("INSERT INTO sessions (token_hash, user_id, expires_at, created_at) VALUES (?, ?, ?, ?)")
      .run(hashToken(token), userId, now + lifetimeMs, now);
    return {
      token,
      maxAgeSeconds: settings.sessionLifetimeHours * 60 * 60,
    };
  }

  getSessionUser(token: string | undefined) {
    if (!token) return null;
    const now = Date.now();
    const row = this.database
      .prepare(`
        SELECT users.* FROM sessions
        JOIN users ON users.id = sessions.user_id
        WHERE sessions.token_hash = ? AND sessions.expires_at > ?
      `)
      .get(hashToken(token), now) as unknown as UserRow | undefined;
    return row ? toAuthUser(row) : null;
  }

  destroySession(token: string | undefined) {
    if (token) this.database.prepare("DELETE FROM sessions WHERE token_hash = ?").run(hashToken(token));
  }

  listUsers() {
    return (this.database
      .prepare("SELECT id, username, role, is_seed, created_at, custom_prompt FROM users ORDER BY created_at ASC")
      .all() as unknown as UserRow[]).map(toAuthUser);
  }

  getSettings(): AuthSettings {
    const row = this.database
      .prepare("SELECT session_lifetime_hours FROM app_settings WHERE id = 1")
      .get() as SettingsRow;
    return {
      sessionLifetimeHours: row.session_lifetime_hours,
    };
  }

  updateSettings(settings: AuthSettings) {
    this.database
      .prepare(`
        UPDATE app_settings
        SET session_lifetime_hours = ?, single_session_only = 1
        WHERE id = 1
      `)
      .run(settings.sessionLifetimeHours);
    return this.getSettings();
  }

  updateUserPrompt(id: string, customPrompt: string) {
    const changed = this.database
      .prepare("UPDATE users SET custom_prompt = ? WHERE id = ?")
      .run(customPrompt, id).changes;
    if (changed !== 1) return null;
    const row = this.database.prepare("SELECT * FROM users WHERE id = ?").get(id) as UserRow;
    return toAuthUser(row);
  }

  async createUser(username: string, password: string) {
    const user: AuthUser = {
      id: randomUUID(),
      username,
      role: "user",
      isSeed: false,
      createdAt: Date.now(),
      customPrompt: "",
    };
    const passwordHash = await hashPassword(password);
    this.database
      .prepare(`
        INSERT INTO users (id, username, password_hash, role, is_seed, created_at)
        VALUES (?, ?, ?, ?, 0, ?)
      `)
      .run(user.id, user.username, passwordHash, user.role, user.createdAt);
    return user;
  }

  deleteUser(id: string) {
    const row = this.database.prepare("SELECT is_seed FROM users WHERE id = ?").get(id) as
      | { is_seed: number }
      | undefined;
    if (!row || row.is_seed === 1) return false;
    return this.database.prepare("DELETE FROM users WHERE id = ?").run(id).changes === 1;
  }

  private initialize() {
    this.database.exec(`
      PRAGMA foreign_keys = ON;
      PRAGMA journal_mode = WAL;
      CREATE TABLE IF NOT EXISTS users (
        id TEXT PRIMARY KEY,
        username TEXT NOT NULL COLLATE NOCASE UNIQUE,
        password_hash TEXT NOT NULL,
        role TEXT NOT NULL CHECK (role IN ('admin', 'user')),
        is_seed INTEGER NOT NULL DEFAULT 0 CHECK (is_seed IN (0, 1)),
        created_at INTEGER NOT NULL,
        custom_prompt TEXT NOT NULL DEFAULT ''
      );
      CREATE TABLE IF NOT EXISTS sessions (
        token_hash TEXT PRIMARY KEY,
        user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        expires_at INTEGER NOT NULL,
        created_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS sessions_expires_at ON sessions(expires_at);
      CREATE TABLE IF NOT EXISTS app_settings (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        session_lifetime_hours INTEGER NOT NULL CHECK (session_lifetime_hours BETWEEN 1 AND 720),
        single_session_only INTEGER NOT NULL CHECK (single_session_only IN (0, 1))
      );
      INSERT OR IGNORE INTO app_settings (id, session_lifetime_hours, single_session_only)
      VALUES (1, ${defaultSessionLifetimeHours}, 0);
    `);
    const columns = this.database.prepare("PRAGMA table_info(users)").all() as Array<{ name: string }>;
    if (!columns.some((column) => column.name === "custom_prompt")) {
      this.database.exec("ALTER TABLE users ADD COLUMN custom_prompt TEXT NOT NULL DEFAULT ''");
    }
  }

  private async seedAdmin() {
    const existing = this.database
      .prepare("SELECT id FROM users WHERE username = ? COLLATE NOCASE")
      .get(seedUsername);
    if (existing) return;
    this.database
      .prepare(`
        INSERT INTO users (id, username, password_hash, role, is_seed, created_at)
        VALUES (?, ?, ?, 'admin', 1, ?)
      `)
      .run(randomUUID(), seedUsername, await hashPassword(seedPassword), Date.now());
  }
}

async function hashPassword(password: string) {
  const salt = randomBytes(16);
  const derived = (await scrypt(password, salt, 64)) as Buffer;
  return `scrypt$${salt.toString("base64url")}$${derived.toString("base64url")}`;
}

async function verifyPassword(password: string, encoded: string) {
  const [, saltValue, hashValue] = encoded.split("$");
  if (!saltValue || !hashValue) return false;
  const expected = Buffer.from(hashValue, "base64url");
  const actual = (await scrypt(password, Buffer.from(saltValue, "base64url"), expected.length)) as Buffer;
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

function hashToken(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

function toAuthUser(row: UserRow): AuthUser {
  return {
    id: row.id,
    username: row.username,
    role: row.role,
    isSeed: row.is_seed === 1,
    createdAt: row.created_at,
    customPrompt: row.custom_prompt,
  };
}