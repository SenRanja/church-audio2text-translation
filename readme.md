# Church Translation

Real-time captions and multilingual translation for church sermons. The browser captures microphone or Windows system audio, Deepgram transcribes it, and OpenAI translates it into multiple synchronized caption panels.

![img](./imgs/WhatsApp%20Image%202026-08-30%20at%2020.29.10.jpeg)

![img](./imgs/WhatsApp%20Image%202026-08-30%20at%2021.16.57.jpeg)

![img](./imgs/WhatsApp%20Image%202026-08-31%20at%2009.22.38.jpeg)

## Key Features

- Supports spoken English, Cantonese, Mandarin, Japanese, Korean, and Indonesian.
- Displays one to three target languages while preserving caption order.
- Captures microphones, USB audio devices, and Windows system audio.
- Includes fullscreen projection, floating captions, font controls, automatic stopping, and transcript downloads.
- Provides user authentication, administrator account management, and up to 10 independent concurrent sessions.

## System Architecture

```text
Microphone / System Audio -> React App -> Fastify Server -> Deepgram
                                      <- Captions      <- Transcript

React App <- Ordered Translations <- Fastify Server -> OpenAI
                                      |-> SQLite Accounts
                                      |-> Source Text Logs
```

## Deployment

```bash
cp .env.example .env
# Set DEEPGRAM_API_KEY, OPENAI_API_KEY, and ALLOWED_ORIGINS
docker compose up --build -d
```

Production must use HTTPS/WSS; browsers block microphone and system audio access on insecure origins.

[Deployment Guide](deployment.md) · [Developer Documentation](developer.md)
