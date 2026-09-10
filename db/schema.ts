import { sqliteTable, text, index, uniqueIndex } from "drizzle-orm/sqlite-core";
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
  },
  (table) => [
    uniqueIndex("idx_profiles_referral_code").on(table.referralCode),
    index("idx_profiles_referred_by").on(table.referredBy),
  ],
);
