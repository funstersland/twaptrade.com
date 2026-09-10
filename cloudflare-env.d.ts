declare namespace Cloudflare {
  interface Env {
    DB?: D1Database;
    TWAP_BOT_ENCRYPTION_KEY?: string;
    TWAP_BOT_RUNNER_TOKEN?: string;
    TWAP_ADMIN_EMAIL?: string;
    TWAP_ADMIN_PASSWORD_HASH?: string;
    BUCKET?: R2Bucket;
  }
}
