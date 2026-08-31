import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import { listOwnedTranscripts, resolveOwnedTranscript, SourceTranscriptWriter } from "./source-transcript-writer";

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
    const first = new SourceTranscriptWriter(directory, onError, "operator-one", "user-one", now);
    const second = new SourceTranscriptWriter(directory, onError, "operator-two", "user-two", now);
    first.configure({ inputMode: "microphone", sourceLanguage: "en-AU", targetLanguages: ["zh-Hans"] });
    second.configure({ inputMode: "system", sourceLanguage: "en-US", targetLanguages: ["id"] });

    first.append("Grace and peace.");
    first.append("Christ is risen.");
    await first.flush();
    second.append("Another session.");
    await second.flush();

    expect((await readdir(directory)).sort()).toEqual(["user-one", "user-two"]);
    expect(await readFile(path.join(directory, "user-one", "2026-08-30_14-05-06.txt"), "utf8")).toBe(
      [
        "Title: Church Translation Source Transcript",
        "User: operator-one",
        "Capture: Microphone",
        "Source language: en-AU",
        "Target languages: zh-Hans",
        "",
        "Transcript:",
        "",
        "Grace and peace.",
        "Christ is risen.",
        "",
      ].join("\n"),
    );
    expect(onError).not.toHaveBeenCalled();
  });

  it("lists only owned files and recognizes matching legacy logs", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "church-owned-log-"));
    temporaryDirectories.push(directory);
    const writer = new SourceTranscriptWriter(
      directory,
      vi.fn(),
      "operator-one",
      "user-one",
      () => new Date(2026, 7, 30, 14, 5, 6),
    );
    writer.append("Owned session.");
    await writer.flush();
    await writeFile(path.join(directory, "2026-08-29_10-00-00.txt"), "Title: Log\nUser: operator-one\n\nLegacy");
    await writeFile(path.join(directory, "2026-08-28_10-00-00.txt"), "Title: Log\nUser: someone-else\n\nPrivate");

    const logs = await listOwnedTranscripts(directory, { id: "user-one", username: "operator-one" });
    expect(logs.map((log) => log.id).sort()).toEqual([
      "legacy.2026-08-29_10-00-00.txt",
      "owned.2026-08-30_14-05-06.txt",
    ]);
    expect(await resolveOwnedTranscript(directory, { id: "user-one", username: "operator-one" }, logs[0]!.id))
      .not.toBeNull();
    expect(await resolveOwnedTranscript(
      directory,
      { id: "user-one", username: "operator-one" },
      "legacy.2026-08-28_10-00-00.txt",
    )).toBeNull();
  });
});