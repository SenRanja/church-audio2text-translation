import type {
  PublicLiveSnapshot,
  PublicLiveEvent,
  ServerMessage,
  SourceLanguage,
  TargetLanguage,
  TranslationSegment,
} from "@church/contracts";

type Listener = (event: PublicLiveEvent) => void;

interface Channel {
  snapshot: PublicLiveSnapshot;
  listeners: Set<Listener>;
}

const maximumCachedSegments = 100;

export class PublicStreamHub {
  private readonly channels = new Map<string, Channel>();

  subscribe(username: string, listener: Listener) {
    const channel = this.getChannel(username);
    channel.listeners.add(listener);
    listener({ type: "snapshot", snapshot: cloneSnapshot(channel.snapshot) });
    return () => {
      channel.listeners.delete(listener);
      if (channel.listeners.size === 0 && channel.snapshot.sessionId === null) {
        this.channels.delete(normalizeUsername(username));
      }
    };
  }

  start(
    username: string,
    sessionId: string,
    sourceLanguage: SourceLanguage,
    targetLanguages: TargetLanguage[],
  ) {
    const channel = this.getChannel(username);
    channel.snapshot = {
      username,
      sessionId,
      sourceLanguage,
      targetLanguages: [...targetLanguages],
      status: "connecting",
      queueDepth: 0,
      interim: "",
      segments: [],
    };
    this.notify(channel, { type: "snapshot", snapshot: cloneSnapshot(channel.snapshot) });
  }

  publish(username: string, sessionId: string, message: ServerMessage) {
    const channel = this.channels.get(normalizeUsername(username));
    if (!channel || channel.snapshot.sessionId !== sessionId) return;

    const snapshot = channel.snapshot;
    let event: PublicLiveEvent | undefined;
    if (message.type === "session.status") {
      snapshot.status = message.status;
      snapshot.queueDepth = message.queueDepth ?? snapshot.queueDepth;
      event = { type: "status", status: snapshot.status, queueDepth: snapshot.queueDepth };
    } else if (message.type === "transcript.interim") {
      snapshot.interim = message.text;
      event = { type: "interim", text: message.text };
    } else if (message.type === "transcript.final") {
      snapshot.interim = "";
      const segment: TranslationSegment = {
        segmentId: message.segmentId,
        sequence: message.sequence,
        source: message.source,
        translations: {},
        startMs: message.startMs,
        endMs: message.endMs,
        state: "translating",
      };
      snapshot.segments = [...snapshot.segments, segment].slice(-maximumCachedSegments);
      event = { type: "segment", segment: cloneSegment(segment) };
    } else if (message.type === "translation.final") {
      snapshot.segments = snapshot.segments.map((segment) =>
        segment.segmentId === message.segmentId
          ? { ...segment, translations: message.translations, state: "complete" }
          : segment,
      );
      const translated = snapshot.segments.find((segment) => segment.segmentId === message.segmentId);
      if (translated) event = { type: "segment", segment: cloneSegment(translated) };
    }
    if (event) this.notify(channel, event);
  }

  end(username: string, sessionId: string) {
    const channel = this.channels.get(normalizeUsername(username));
    if (!channel || channel.snapshot.sessionId !== sessionId) return;
    channel.snapshot = offlineSnapshot(channel.snapshot.username);
    this.notify(channel, { type: "offline" });
    if (channel.listeners.size === 0) this.channels.delete(normalizeUsername(username));
  }

  private getChannel(username: string) {
    const key = normalizeUsername(username);
    let channel = this.channels.get(key);
    if (!channel) {
      channel = { snapshot: offlineSnapshot(username), listeners: new Set() };
      this.channels.set(key, channel);
    }
    return channel;
  }

  private notify(channel: Channel, event: PublicLiveEvent) {
    for (const listener of channel.listeners) listener(event);
  }
}

function normalizeUsername(username: string) {
  return username.toLocaleLowerCase("en-US");
}

function offlineSnapshot(username: string): PublicLiveSnapshot {
  return {
    username,
    sessionId: null,
    sourceLanguage: null,
    targetLanguages: [],
    status: "offline",
    queueDepth: 0,
    interim: "",
    segments: [],
  };
}

function cloneSnapshot(snapshot: PublicLiveSnapshot): PublicLiveSnapshot {
  return {
    ...snapshot,
    targetLanguages: [...snapshot.targetLanguages],
    segments: snapshot.segments.map(cloneSegment),
  };
}

function cloneSegment(segment: TranslationSegment): TranslationSegment {
  return { ...segment, translations: { ...segment.translations } };
}