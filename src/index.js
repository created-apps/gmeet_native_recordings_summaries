const cron = require("node-cron");
const { config } = require("./lib/config");
const logger = require("./lib/logger");
const { runOnce } = require("./lib/processor");

let running = false;

async function tick(trigger) {
  if (running) {
    logger.warn("previous run still in progress, skipping tick", { trigger });

    return;
  }

  running = true;

  try {
    await runOnce();
  } catch (error) {
    logger.error("run crashed", { trigger, error: error.message });
  } finally {
    running = false;
  }
}

async function main() {
  const once = process.argv.includes("--once");

  if (once) {
    await tick("manual");

    return;
  }

  if (!cron.validate(config.cron.schedule)) {
    throw new Error(`Invalid CRON_SCHEDULE: ${config.cron.schedule}`);
  }

  cron.schedule(config.cron.schedule, () => tick("cron"), {
    timezone: config.cron.timezone
  });

  logger.info("cron scheduled", {
    schedule: config.cron.schedule,
    timezone: config.cron.timezone,
    worker: config.workerId
  });

  // Don't wait an hour for the first run.
  await tick("startup");
}

main().catch(error => {
  logger.error("fatal", { error: error.message });

  process.exit(1);
});
