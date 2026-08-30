import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import { SourceTranscriptWriter } from "./source-transcript-writer";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

describe("SourceTranscriptWriter", () => {
  it("writes only source text to a timestamp-named file without overwriting collisions", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "church-source-log-"));
    temporaryDirectories.push(directory);
    const now = () => new Date(2026, 7, 30, 14, 5, 6);
    const onError = vi.fn();
    const first = new SourceTranscriptWriter(directory, onError, now);
    const second = new SourceTranscriptWriter(directory, onError, now);

    first.append("Grace and peace.");
    first.append("Christ is risen.");
    await first.flush();
    second.append("Another session.");
    await second.flush();

    expect((await readdir(directory)).sort()).toEqual([
      "2026-08-30_14-05-06-2.txt",
      "2026-08-30_14-05-06.txt",
    ]);
    expect(await readFile(path.join(directory, "2026-08-30_14-05-06.txt"), "utf8")).toBe(
      "Grace and peace.\nChrist is risen.\n",
    );
    expect(onError).not.toHaveBeenCalled();
  });
});