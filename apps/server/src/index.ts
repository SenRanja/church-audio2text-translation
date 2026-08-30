import path from "node:path";
import { fileURLToPath } from "node:url";

import { config as loadEnvironment } from "dotenv";

import { loadConfig } from "./config";
import { buildServer } from "./server";

const applicationRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
loadEnvironment({ path: path.join(applicationRoot, ".env"), quiet: true });

const config = loadConfig();
const server = await buildServer(config);

try {
  await server.listen({ host: "0.0.0.0", port: config.port });
} catch (error) {
  server.log.error(error);
  process.exit(1);
}