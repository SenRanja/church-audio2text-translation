import { appendFile, mkdir, open } from "node:fs/promises";
import path from "node:path";

export class SourceTranscriptWriter {
  private filePath: string | undefined;
  private writeQueue: Promise<void> = Promise.resolve();

  constructor(
    private readonly logDirectory: string,
    private readonly onError: (error: unknown) => void,
    private readonly now: () => Date = () => new Date(),
  ) {}

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
    await mkdir(this.logDirectory, { recursive: true });
    const timestamp = formatTimestamp(this.now());

    for (let suffix = 1; ; suffix += 1) {
      const filename = suffix === 1 ? `${timestamp}.txt` : `${timestamp}-${suffix}.txt`;
      const filePath = path.join(this.logDirectory, filename);
      try {
        const handle = await open(filePath, "wx");
        await handle.close();
        return filePath;
      } catch (error) {
        if (isAlreadyExists(error)) continue;
        throw error;
      }
    }
  }
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