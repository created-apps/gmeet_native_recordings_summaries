function log(level, message, extra) {
  const line = {
    at: new Date().toISOString(),
    level,
    message,
    ...(extra || {})
  };

  console.log(JSON.stringify(line));
}

module.exports = {
  info: (message, extra) => log("info", message, extra),
  warn: (message, extra) => log("warn", message, extra),
  error: (message, extra) => log("error", message, extra)
};
