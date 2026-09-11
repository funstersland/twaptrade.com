import { sql } from "drizzle-orm";
import {
  sqliteTable,
  text,
  integer,
  index,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";

// CheapShare owns its state and append-only execution journal. No account ledger writes.
export const cheapshareRuns = sqliteTable("cheapshare_runs", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull().references(() => profiles.userId),
  botId: text("bot_id").notNull().references(() => bots.id),
  mode: text("mode").notNull(),
  strategyVersion: integer("strategy_version").notNull().default(1),
  revision: integer("revision").notNull().default(0),
  lastEvent: text("last_event").notNull(),
  stateJson: text("state_json").notNull(),
  walletAddress: text("wallet_address"),
  walletCipher: text("wallet_cipher"),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
}, t => [uniqueIndex("idx_cheapshare_user_bot_mode").on(t.userId,t.botId,t.mode,t.strategyVersion)]);
export const cheapshareEvents = sqliteTable("cheapshare_events", {
  id: text("id").primaryKey(),
  runId: text("run_id").notNull().references(() => cheapshareRuns.id),
  revision: integer("revision").notNull(),
  kind: text("kind").notNull(),
  dataJson: text("data_json").notNull(),
  createdAt: text("created_at").notNull(),
}, t => [uniqueIndex("idx_cheapshare_event_revision").on(t.runId,t.revision),index("idx_cheapshare_event_kind").on(t.runId,t.kind,t.createdAt)]);
export const cheapshareMarkets = sqliteTable("cheapshare_markets", {
  slug: text("slug").primaryKey(),
  strike: text("strike").notNull(),
  source: text("source").notNull(),
  lockedAt: integer("locked_at").notNull(),
});
export const cheapshareFeed = sqliteTable("cheapshare_feed", {
  id: text("id").primaryKey(),
  lease: text("lease").notNull(),
  leaseUntil: integer("lease_until").notNull(),
  heartbeat: integer("heartbeat").notNull(),
  dataJson: text("data_json").notNull(),
});
export const profiles = sqliteTable(
  "profiles",
  {
    userId: text("user_id").primaryKey(),
    displayName: text("display_name").notNull(),
    referralCode: text("referral_code").notNull(),
    referredBy: text("referred_by"),
    createdAt: text("created_at").notNull(),
    lastLoginAt: text("last_login_at").notNull(),
    preferences: text("preferences").notNull().default("{}"),
    email: text("email"),
    role: text("role").notNull().default("user"),
    status: text("status").notNull().default("active"),
    notes: text("notes").notNull().default(""),
    authMethod: text("auth_method").notNull().default("chatgpt"),
    welcomeSeen: integer("welcome_seen").notNull().default(0),
    lastSessionAccent: text("last_session_accent").notNull().default("mint"),
  },
  (t) => [
    uniqueIndex("idx_profiles_referral_code").on(t.referralCode),
    index("idx_profiles_referred_by").on(t.referredBy),
    uniqueIndex("idx_profiles_email").on(t.email),
    index("idx_profiles_status").on(t.status),
  ],
);
export const credentials = sqliteTable("credentials", {
  userId: text("user_id")
    .primaryKey()
    .references(() => profiles.userId),
  passwordHash: text("password_hash").notNull(),
  updatedAt: text("updated_at").notNull(),
});
export const sessions = sqliteTable(
  "sessions",
  {
    tokenHash: text("token_hash").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => profiles.userId),
    createdAt: text("created_at").notNull(),
    expiresAt: integer("expires_at").notNull(),
    userAgent: text("user_agent").notNull().default(""),
    accent: text("accent").notNull().default("mint"),
  },
  (t) => [
    index("idx_sessions_user").on(t.userId),
    index("idx_sessions_expiry").on(t.expiresAt),
  ],
);
export const passwordResets = sqliteTable(
  "password_resets",
  {
    tokenHash: text("token_hash").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => profiles.userId),
    expiresAt: integer("expires_at").notNull(),
    createdAt: text("created_at").notNull(),
    usedAt: text("used_at"),
  },
  (t) => [index("idx_resets_user").on(t.userId)],
);
export const authLimits = sqliteTable("auth_limits", {
  key: text("key").primaryKey(),
  attempts: integer("attempts").notNull(),
  resetAt: integer("reset_at").notNull(),
});
export const bots = sqliteTable(
  "bots",
  {
    family: text("family"),
    strategyKey: text("strategy_key"),
    id: text("id").primaryKey(),
    name: text("name").notNull(),
    pair: text("pair").notNull(),
    description: text("description").notNull().default(""),
    status: text("status").notNull().default("draft"),
    minAllocationCents: integer("min_allocation_cents").notNull().default(0),
    createdBy: text("created_by").notNull(),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (t) => [
    index("idx_bots_status").on(t.status),
    uniqueIndex("idx_bots_family_name").on(t.family, sql`lower(${t.name})`),
  ],
);
export const deployments = sqliteTable(
  "deployments",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => profiles.userId),
    botId: text("bot_id")
      .notNull()
      .references(() => bots.id),
    allocationCents: integer("allocation_cents").notNull().default(0),
    status: text("status").notNull().default("requested"),
    note: text("note").notNull().default(""),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (t) => [
    index("idx_deployments_user").on(t.userId),
    index("idx_deployments_bot").on(t.botId),
  ],
);
export const transactions = sqliteTable(
  "transactions",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => profiles.userId),
    type: text("type").notNull(),
    asset: text("asset").notNull(),
    quantity: text("quantity").notNull(),
    amountCents: integer("amount_cents").notNull(),
    balanceDeltaCents: integer("balance_delta_cents").notNull().default(0),
    status: text("status").notNull(),
    providerRef: text("provider_ref"),
    createdAt: text("created_at").notNull(),
  },
  (t) => [
    index("idx_transactions_user").on(t.userId),
    uniqueIndex("idx_transactions_provider_ref").on(t.providerRef),
  ],
);
export const holdings = sqliteTable(
  "holdings",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => profiles.userId),
    symbol: text("symbol").notNull(),
    name: text("name").notNull(),
    quantity: text("quantity").notNull(),
    valueCents: integer("value_cents"),
    updatedAt: text("updated_at").notNull(),
  },
  (t) => [uniqueIndex("idx_holdings_user_symbol").on(t.userId, t.symbol)],
);
export const snapshots = sqliteTable(
  "portfolio_snapshots",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => profiles.userId),
    valueCents: integer("value_cents").notNull(),
    recordedAt: text("recorded_at").notNull(),
  },
  (t) => [index("idx_snapshots_user_time").on(t.userId, t.recordedAt)],
);
export const platformSettings = sqliteTable("platform_settings", {
  key: text("key").primaryKey(),
  value: text("value").notNull(),
  updatedAt: text("updated_at").notNull(),
});
export const auditLog = sqliteTable(
  "audit_log",
  {
    id: text("id").primaryKey(),
    actorId: text("actor_id").notNull(),
    action: text("action").notNull(),
    targetId: text("target_id").notNull(),
    details: text("details").notNull().default("{}"),
    createdAt: text("created_at").notNull(),
  },
  (t) => [
    index("idx_audit_created").on(t.createdAt),
    index("idx_audit_actor").on(t.actorId),
  ],
);
export const profitLossBatches = sqliteTable(
  "profit_loss_batches",
  {
    id: text("id").primaryKey(),
    actorId: text("actor_id")
      .notNull()
      .references(() => profiles.userId),
    direction: text("direction").notNull(),
    amountCents: integer("amount_cents").notNull(),
    recipientIds: text("recipient_ids").notNull(),
    status: text("status").notNull().default("prepared"),
    postingToken: text("posting_token"),
    createdAt: text("created_at").notNull(),
    expiresAt: integer("expires_at").notNull(),
    appliedAt: text("applied_at"),
  },
  (t) => [
    index("idx_profit_loss_actor").on(t.actorId),
    index("idx_profit_loss_created").on(t.createdAt),
  ],
);

export const continuationRuns = sqliteTable(
  "continuation_runs",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => profiles.userId),
    botId: text("bot_id")
      .notNull()
      .references(() => bots.id),
    mode: text("mode").notNull(),
    status: text("status").notNull().default("paused"),
    baseLotCents: integer("base_lot_cents").notNull(),
    lossStreak: integer("loss_streak").notNull().default(0),
    paperCashMicros: integer("paper_cash_micros").notNull().default(0),
    walletAddress: text("wallet_address"),
    walletCipher: text("wallet_cipher"),
    walletType: text("wallet_type"),
    connectionStatus: text("connection_status")
      .notNull()
      .default("disconnected"),
    walletBalanceMicros: integer("wallet_balance_micros"),
    forcedMinimum: integer("forced_minimum").notNull().default(0),
    message: text("message").notNull().default(""),
    checkedAt: integer("checked_at"),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (t) => [
    uniqueIndex("idx_continuation_user_bot_mode").on(t.userId, t.botId, t.mode),
    index("idx_continuation_status").on(t.status),
  ],
);
export const continuationRounds = sqliteTable(
  "continuation_rounds",
  {
    id: text("id").primaryKey(),
    runId: text("run_id")
      .notNull()
      .references(() => continuationRuns.id),
    startSeconds: integer("start_seconds").notNull(),
    marketSlug: text("market_slug").notNull(),
    conditionId: text("condition_id"),
    tokenId: text("token_id"),
    direction: text("direction"),
    stakeCents: integer("stake_cents").notNull(),
    status: text("status").notNull(),
    referencePrice: text("reference_price"),
    signalPrice: text("signal_price"),
    orderId: text("order_id"),
    costMicros: integer("cost_micros").notNull().default(0),
    sharesMicros: integer("shares_micros").notNull().default(0),
    feeMicros: integer("fee_micros").notNull().default(0),
    soldSharesMicros: integer("sold_shares_micros").notNull().default(0),
    saleProceedsMicros: integer("sale_proceeds_micros").notNull().default(0),
    saleFeeMicros: integer("sale_fee_micros").notNull().default(0),
    exitStableSince: integer("exit_stable_since"),
    exitBidMicros: integer("exit_bid_micros"),
    markMicros: integer("mark_micros"),
    payoutMicros: integer("payout_micros"),
    pnlMicros: integer("pnl_micros"),
    winner: text("winner"),
    reason: text("reason").notNull().default(""),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (t) => [
    uniqueIndex("idx_continuation_run_round").on(t.runId, t.startSeconds),
    index("idx_continuation_round_status").on(t.status),
    uniqueIndex("idx_continuation_order").on(t.orderId),
  ],
);
export const continuationFeed = sqliteTable("continuation_feed", {
  id: text("id").primaryKey(),
  heartbeat: integer("heartbeat").notNull(),
  observedAt: integer("observed_at"),
  priceE18: text("price_e18"),
  roundStart: integer("round_start"),
  openE18: text("open_e18"),
  market: text("market"),
  nextMarket: text("next_market"),
  leaseToken: text("lease_token"),
  leaseUntil: integer("lease_until").notNull().default(0),
  message: text("message").notNull().default(""),
});

export const continuationFills = sqliteTable("continuation_fills", {
  id: text("id").primaryKey(),
  roundId: text("round_id").notNull().references(() => continuationRounds.id),
  orderId: text("order_id").notNull(),
  side: text("side").notNull(),
  tokenId: text("token_id").notNull(),
  transactionHash: text("transaction_hash").notNull(),
  logIndex: integer("log_index").notNull(),
  blockNumber: integer("block_number").notNull(),
  grossMicros: integer("gross_micros").notNull(),
  sharesMicros: integer("shares_micros").notNull(),
  feeMicros: integer("fee_micros").notNull(),
  cashMicros: integer("cash_micros").notNull(),
  price: text("price").notNull(),
  tradeIds: text("trade_ids").notNull(),
  confirmedAt: text("confirmed_at").notNull(),
}, (t) => [index("idx_continuation_fills_round").on(t.roundId), index("idx_continuation_fills_order").on(t.orderId)]);

export const continuationOrders = sqliteTable("continuation_orders", {
  id: text("id").primaryKey(),
  roundId: text("round_id").notNull().references(() => continuationRounds.id),
  side: text("side").notNull().default("SELL"),
  status: text("status").notNull(),
  requestedSharesMicros: integer("requested_shares_micros").notNull(),
  walletSharesMicros: integer("wallet_shares_micros"),
  botSharesMicros: integer("bot_shares_micros"),
  filledSharesMicros: integer("filled_shares_micros"),
  grossMicros: integer("gross_micros"),
  feeMicros: integer("fee_micros"),
  cashMicros: integer("cash_micros"),
  limitPrice: text("limit_price").notNull(),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
}, t => [index("idx_continuation_orders_round").on(t.roundId)]);

// Scalper has its own state, performance journal and feed. No account-ledger writes.
export const scalperRuns = sqliteTable("scalper_runs", {
  id: text("id").primaryKey(), userId: text("user_id").notNull().references(() => profiles.userId),
  botId: text("bot_id").notNull().references(() => bots.id), mode: text("mode").notNull(),
  revision: integer("revision").notNull().default(0), lastEvent: text("last_event").notNull(),
  stateJson: text("state_json").notNull(), walletAddress: text("wallet_address"), walletCipher: text("wallet_cipher"),
  createdAt: text("created_at").notNull(), updatedAt: text("updated_at").notNull(),
}, t => [uniqueIndex("idx_scalper_user_bot_mode").on(t.userId,t.botId,t.mode)]);
export const scalperEvents = sqliteTable("scalper_events", {
  id: text("id").primaryKey(), runId: text("run_id").notNull().references(() => scalperRuns.id),
  revision: integer("revision").notNull(), kind: text("kind").notNull(), dataJson: text("data_json").notNull(),
  createdAt: text("created_at").notNull(),
}, t => [uniqueIndex("idx_scalper_event_revision").on(t.runId,t.revision)]);
export const scalperFeed = sqliteTable("scalper_feed", {
  id: text("id").primaryKey(), lease: text("lease").notNull(), leaseUntil: integer("lease_until").notNull(),
  heartbeat: integer("heartbeat").notNull(), dataJson: text("data_json").notNull(),
});
