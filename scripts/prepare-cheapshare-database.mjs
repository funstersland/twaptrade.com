await import("./migrate-postgres.mjs");
if (process.exitCode) process.exit(process.exitCode);
await import("./register-cheapshare.mjs");
