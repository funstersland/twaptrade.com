// Railway runs one executable for pre-deploy; shell operators in a Node command
// become arguments. Keep the existing release setup, then register Scalper.
await import("./prepare-cheapshare-database.mjs");
if (process.exitCode) process.exit(process.exitCode);
await import("./register-scalper.mjs");
await import("./update-continuation.mjs");
