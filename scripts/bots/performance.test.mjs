import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { closedTradeRisk } from "../../lib/bot-performance.ts";
import { continuationRisk } from "../../lib/bots/crypto-shares/continuation/performance.ts";
import { cheapshareRisk } from "../../lib/bots/crypto-shares/cheapshare/performance.ts";

test("drawdown includes initial losses, partial recovery, and recovered historical peaks", () => {
  assert.deepEqual(closedTradeRisk([-10, -20, 50, -15, 5, -25, 100]), {
    maxDrawdownMicros: 35,
    maxLosingStreak: 2,
  });
  assert.deepEqual(closedTradeRisk([-10, -20]), {
    maxDrawdownMicros: 30,
    maxLosingStreak: 2,
  });
});

test("longest losing streak survives recovery and break-even ends consecutive losses", () => {
  assert.equal(closedTradeRisk([-1, -1, -1, 5, -1, 0, -1]).maxLosingStreak, 3);
  assert.equal(closedTradeRisk([-1, 0, -1]).maxLosingStreak, 1);
  assert.deepEqual(closedTradeRisk([0, 1, 2]), {
    maxDrawdownMicros: 0,
    maxLosingStreak: 0,
  });
});

test("missing or imprecise history is unavailable, not zero risk", () => {
  for (const profits of [[], [null], [-1, null, -1], [NaN], [Infinity], [0.1], [Number.MAX_SAFE_INTEGER, 1]]) {
    assert.equal(closedTradeRisk(profits), null);
  }
});

function fixture(t) {
  const sqlite = new DatabaseSync(":memory:");
  t.after(() => sqlite.close());
  sqlite.exec(`
    CREATE TABLE continuation_rounds (
      id TEXT, run_id TEXT, start_seconds INTEGER, status TEXT, pnl_micros INTEGER
    );
    CREATE UNIQUE INDEX idx_continuation_run_round ON continuation_rounds(run_id, start_seconds);
    CREATE TABLE cheapshare_events (
      id TEXT, run_id TEXT, revision INTEGER, kind TEXT, data_json TEXT
    );
    CREATE UNIQUE INDEX idx_cheapshare_event_revision ON cheapshare_events(run_id, revision);
  `);
  const db = {
    prepare(sql) {
      return {
        bind(...params) {
          return { async all() { return { results: sqlite.prepare(sql).all(...params) }; } };
        },
      };
    },
  };
  return { sqlite, db };
}

test("Continuation uses all closed rounds in order, isolating run and mode", async (t) => {
  const { sqlite, db } = fixture(t);
  const insert = sqlite.prepare("INSERT INTO continuation_rounds VALUES(?,?,?,?,?)");
  // Insert out of order; the maximum is older than the 20-row history page.
  for (let n = 40; n >= 1; n--) {
    const pnl = n <= 3 ? -10_000_000 : 2_000_000;
    insert.run(String(n), "member-a-paper", n * 300, pnl < 0 ? "lost" : "won", pnl);
  }
  insert.run("live", "member-a-live", 300, "lost", -999_000_000);
  insert.run("other", "member-b-paper", 300, "lost", -888_000_000);
  for (const [i, status] of ["open", "submitted", "unfilled", "skipped"].entries()) {
    insert.run(status, "member-a-paper", (41 + i) * 300, status, -777_000_000);
  }
  assert.deepEqual(await continuationRisk(db, "member-a-paper"), {
    maxDrawdownMicros: 30_000_000,
    maxLosingStreak: 3,
  });
  assert.equal(await continuationRisk(db, "empty"), null);
  insert.run("missing", "missing-pnl", 300, "lost", null);
  assert.equal(await continuationRisk(db, "missing-pnl"), null);
});

test("CheapShare uses final net P/L in close order across pages, at the requested revision", async (t) => {
  const { sqlite, db } = fixture(t);
  const insert = sqlite.prepare("INSERT INTO cheapshare_events VALUES(?,?,?,?,?)");
  function event(run, revision, kind, pnl) {
    insert.run(`${run}-${revision}`, run, revision, kind, JSON.stringify({
      closed: { pnl, proceeds: 900_000_000, cost: 500_000_000 },
      command: { action: "fill" },
    }));
  }
  // Concurrent positions may close in a different order from their entries.
  for (let revision = 40; revision >= 1; revision--) {
    event("member-a-paper", revision, "closed", revision <= 4 ? -5_000_000 : 1_000_000);
  }
  event("member-a-paper", 41, "closed", -999_000_000);
  event("member-a-live", 1, "closed", -888_000_000);
  event("member-b-paper", 1, "closed", -777_000_000);
  event("member-a-paper", 42, "fill", -666_000_000);
  event("member-a-paper", 43, "uncertain", -555_000_000);
  assert.deepEqual(await cheapshareRisk(db, "member-a-paper", 40), {
    maxDrawdownMicros: 20_000_000,
    maxLosingStreak: 4,
  });
  assert.deepEqual(await cheapshareRisk(db, "member-a-paper", 43), {
    maxDrawdownMicros: 999_000_000,
    maxLosingStreak: 4,
  });
  assert.equal(await cheapshareRisk(db, "empty", 43), null);
});
