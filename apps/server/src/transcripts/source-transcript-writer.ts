import { appendFile, mkdir, open, readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";
import type { SourceLanguage, TargetLanguage } from "@church/contracts";

interface TranscriptDetails {
  inputMode: "microphone" | "system";
  sourceLanguage: SourceLanguage;
  targetLanguages: TargetLanguage[];
}

export interface OwnedTranscript {
  id: string;
  filename: string;
  createdAt: number;
}

interface TranscriptOwner {
  id: string;
  username: string;
}

export class SourceTranscriptWriter {
  private filePath: string | undefined;
  private writeQueue: Promise<void> = Promise.resolve();
  private details: TranscriptDetails | undefined;

  constructor(
    private readonly logDirectory: string,
    private readonly onError: (error: unknown) => void,
    private readonly username: string,
    private readonly userId: string,
    private readonly now: () => Date = () => new Date(),
  ) {}

  configure(details: TranscriptDetails) {
    this.details = details;
  }

  append(source: string) {
    const text = source.trim();
    if (!text) return;

    this.writeQueue = this.writeQueue
      .then(async () => {
        this.filePath ??= await this.createFile();
        await appendFile(this.filePath, `${text}\n`, "utf8");
      })
      .catch((error: unknown) => this.onError(error));
  }

  async flush() {
    await this.writeQueue;
  }

  private async createFile() {
    const userDirectory = path.join(this.logDirectory, this.userId);
    await mkdir(userDirectory, { recursive: true });
    const timestamp = formatTimestamp(this.now());

    for (let suffix = 1; ; suffix += 1) {
      const filename = suffix === 1 ? `${timestamp}.txt` : `${timestamp}-${suffix}.txt`;
      const filePath = path.join(userDirectory, filename);
      try {
        const handle = await open(filePath, "wx");
        await handle.writeFile(this.header(), "utf8");
        await handle.close();
        return filePath;
      } catch (error) {
        if (isAlreadyExists(error)) continue;
        throw error;
      }
    }
  }

  private header() {
    const details = this.details;
    const capture = details?.inputMode === "system" ? "Screen / system audio" : "Microphone";
    return [
      "Title: Church Translation Source Transcript",
      `User: ${this.username}`,
      `Capture: ${capture}`,
      `Source language: ${details?.sourceLanguage ?? "Unknown"}`,
      `Target languages: ${details?.targetLanguages.join(", ") ?? "Unknown"}`,
      "",
      "Transcript:",
      "",
      "",
    ].join("\n");
  }
}

export async function listOwnedTranscripts(
  logDirectory: string,
  owner: TranscriptOwner,
  limit = 14,
): Promise<OwnedTranscript[]> {
  const current = await transcriptFiles(path.join(logDirectory, owner.id), "owned");
  const legacy = await transcriptFiles(logDirectory, "legacy", owner.username);
  return [...current, ...legacy]
    .sort((left, right) => right.createdAt - left.createdAt)
    .slice(0, limit);
}

export async function resolveOwnedTranscript(
  logDirectory: string,
  owner: TranscriptOwner,
  transcriptId: string,
) {
  const match = /^(owned|legacy)\.([0-9]{4}-[0-9]{2}-[0-9]{2}_[0-9]{2}-[0-9]{2}-[0-9]{2}(?:-[0-9]+)?\.txt)$/.exec(transcriptId);
  if (!match) return null;
  const scope = match[1]!;
  const filename = match[2]!;
  const filePath = path.join(logDirectory, ...(scope === "owned" ? [owner.id, filename] : [filename]));
  try {
    if (scope === "legacy" && !(await belongsToLegacyUser(filePath, owner.username))) return null;
    if (!(await stat(filePath)).isFile()) return null;
    return { filePath, filename };
  } catch {
    return null;
  }
}

async function transcriptFiles(directory: string, scope: "owned" | "legacy", username?: string) {
  try {
    const names = await readdir(directory);
    const transcripts = await Promise.all(names.filter(isTranscriptFilename).map(async (filename) => {
      const filePath = path.join(directory, filename);
      if (scope === "legacy" && !(await belongsToLegacyUser(filePath, username ?? ""))) return null;
      const details = await stat(filePath);
      if (!details.isFile()) return null;
      return { id: `${scope}.${filename}`, filename, createdAt: details.mtimeMs };
    }));
    return transcripts.filter((transcript): transcript is OwnedTranscript => transcript !== null);
  } catch (error) {
    if (isNotFound(error)) return [];
    throw error;
  }
}

async function belongsToLegacyUser(filePath: string, username: string) {
  try {
    const contents = await readFile(filePath, "utf8");
    return contents.split("\n", 4).includes(`User: ${username}`);
  } catch {
    return false;
  }
}

function isTranscriptFilename(filename: string) {
  return /^[0-9]{4}-[0-9]{2}-[0-9]{2}_[0-9]{2}-[0-9]{2}-[0-9]{2}(?:-[0-9]+)?\.txt$/.test(filename);
}

function formatTimestamp(date: Date) {
  const part = (value: number) => value.toString().padStart(2, "0");
  return [
    date.getFullYear(),
    part(date.getMonth() + 1),
    part(date.getDate()),
  ].join("-") + `_${part(date.getHours())}-${part(date.getMinutes())}-${part(date.getSeconds())}`;
}

function isAlreadyExists(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error && error.code === "EEXIST";
}

function isNotFound(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error && error.code === "ENOENT";
}