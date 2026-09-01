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
- Publishes a read-only live caption page at `https://<domain>/<username>` without additional AI calls.
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

## Manual npm Operation

Node.js 22 or newer is required. Both production and development modes read the repository-root `.env` file.

Install dependencies and build the web and server applications:

```bash
npm ci
npm run build
```

Start the previously built production application in the foreground:

```bash
npm start
```

Press `Ctrl+C` to stop it. After pulling code changes, run `npm ci` and `npm run build` again before starting it. For local development with automatic reloads, use:

```bash
npm run dev
```

## Manual Docker Operation

Run these commands from the repository root. Compose uses `.env` for build settings and injects it into the running application.

```bash
# Build and start in the background
docker compose --env-file .env up -d --build

# Show container status
docker compose --env-file .env ps

# Follow application logs; press Ctrl+C to stop following
docker compose --env-file .env logs -f church-translation

# Stop without deleting the container
docker compose --env-file .env stop church-translation

# Start an existing stopped container
docker compose --env-file .env start church-translation

# Restart the container
docker compose --env-file .env restart church-translation

# Rebuild after code or .env changes and recreate the container
docker compose --env-file .env build --pull church-translation
docker compose --env-file .env up -d --no-build --force-recreate church-translation

# Stop and remove this Compose project's container and network
docker compose --env-file .env down
```

The configured host data and log directories are not removed by `docker compose down`.

On a production host using the automatic deployment timer, pause it before taking manual control so it does not restart or replace the container:

```bash
sudo systemctl stop church-translation-deploy.timer
# Run the required docker compose commands here.
sudo systemctl start church-translation-deploy.timer
```

To run one normal CI-promoted deployment manually instead, use:

```bash
sudo systemctl start church-translation-deploy.service
sudo journalctl -u church-translation-deploy.service -n 100 --no-pager
```

[Deployment Guide](deployment.md) · [Developer Documentation](developer.md)
