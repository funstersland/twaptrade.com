import { postgresDatabase } from "./postgres";

// Next's Railway build resolves cloudflare:workers to this server-only module.
export const env = new Proxy({} as Cloudflare.Env, {
  get(_target, key: string) {
    return key === "DB" ? postgresDatabase : process.env[key];
  },
});
