import app from "./app";
import { logger } from "./lib/logger";
import { isIP } from "node:net";

const rawPort = process.env["PORT"];
const listenHost = process.env["API_LISTEN_HOST"];

if (!rawPort) {
  throw new Error(
    "PORT environment variable is required but was not provided.",
  );
}

const port = Number(rawPort);

if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

if (listenHost !== undefined && isIP(listenHost) === 0) {
  throw new Error(`Invalid API_LISTEN_HOST value: "${listenHost}"`);
}

const onListen = (err?: Error) => {
  if (err) {
    logger.error({ err }, "Error listening on port");
    process.exit(1);
  }

  logger.info({ port, ...(listenHost === undefined ? {} : { host: listenHost }) }, "Server listening");
};

if (listenHost === undefined) {
  app.listen(port, onListen);
} else {
  app.listen(port, listenHost, onListen);
}
