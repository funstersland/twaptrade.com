"use client";
import { useEffect, useState } from "react";
import { Check, Search } from "lucide-react";
import { toast } from "sonner";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogCancel,
  AlertDialogAction,
} from "@/components/ui/alert-dialog";
import { DataTable, Metrics, requestJSON, money } from "./workspace-components";
type Member = {
  user_id: string;
  display_name: string;
  email: string | null;
  balance_cents: number;
  available_cents: number;
};
type Data = {
  rows: Member[];
  total: number;
  page: number;
  pageSize: number;
  totals: {
    members: number;
    profit_cents: number;
    loss_cents: number;
    entries: number;
  };
};
type Review = {
  batchId: string;
  direction: "profit" | "loss";
  amountCents: number;
  count: number;
  totalCents: number;
  recipients: { name: string; email: string | null }[];
  expiresAt: number;
};
export function ProfitLoss({ refreshKey = 0 }: { refreshKey?: number }) {
  const [data, setData] = useState<Data | null>(null),
    [error, setError] = useState(""),
    [search, setSearch] = useState(""),
    [query, setQuery] = useState(""),
    [page, setPage] = useState(1),
    [reload, setReload] = useState(0),
    [mode, setMode] = useState("single"),
    [selected, setSelected] = useState<string[]>([]),
    [direction, setDirection] = useState("profit"),
    [amount, setAmount] = useState(""),
    [review, setReview] = useState<Review | null>(null),
    [busy, setBusy] = useState(false),
    [loading, setLoading] = useState(true);
  useEffect(() => {
    let current = true;
    setLoading(true);
    setError("");
    requestJSON<Data>(
      `/api/profit-loss?${new URLSearchParams({ q: query, page: String(page) })}`,
    )
      .then((result) => {
        if (current) setData(result);
      })
      .catch((e) => {
        if (current) setError(e.message);
      })
      .finally(() => {
        if (current) setLoading(false);
      });
    return () => {
      current = false;
    };
  }, [query, page, reload, refreshKey]);
  const count = mode === "all" ? data?.totals.members || 0 : selected.length;
  async function prepare(e: React.FormEvent) {
    e.preventDefault();
    if (!/^\d+(\.\d{1,2})?$/.test(amount) || Number(amount) <= 0) {
      toast.error("Enter a positive amount with up to two decimal places.");
      return;
    }
    setBusy(true);
    try {
      setReview(
        await requestJSON<Review>("/api/profit-loss", {
          action: "prepare",
          direction,
          amountCents: Math.round(Number(amount) * 100),
          mode,
          userIds: mode === "all" ? [] : selected,
        }),
      );
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function apply() {
    if (!review) return;
    setBusy(true);
    try {
      const result = await requestJSON<{ count: number }>("/api/profit-loss", {
        action: "apply",
        batchId: review.batchId,
      });
      toast.success(
        `${review.direction === "profit" ? "Profit" : "Loss"} posted to ${result.count} ${result.count === 1 ? "member" : "members"}.`,
      );
      setReview(null);
      setAmount("");
      setSelected([]);
      setReload((v) => v + 1);
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  function select(id: string, checked: boolean) {
    if (mode === "single") {
      setSelected(checked ? [id] : []);
      return;
    }
    if (checked && selected.length >= 400) {
      toast.error("Select up to 400 members, or choose all active members.");
      return;
    }
    setSelected((prev) => {
      return checked
        ? [...prev.filter((v) => v !== id), id]
        : prev.filter((v) => v !== id);
    });
  }
  return (
    <>
      {error && (
        <div className="error-banner" role="alert">
          <span>{error}</span>
          <button onClick={() => setReload((v) => v + 1)}>Try again</button>
        </div>
      )}
      {!data && loading && (
        <div className="loading-state">Loading account balances…</div>
      )}
      {data && (
        <>
          <Metrics
            items={[
              {
                label: "Profit posted",
                value: money(data.totals.profit_cents),
              },
              { label: "Loss posted", value: money(data.totals.loss_cents) },
              {
                label: "Net profit / loss",
                value: money(data.totals.profit_cents - data.totals.loss_cents),
              },
              { label: "Entries", value: data.totals.entries },
            ]}
          />
          <form className="panel pnl-controls" onSubmit={prepare}>
            <div className="form-columns">
              <div>
                <label className="control-label">Entry type</label>
                <RadioGroup
                  className="choice-options"
                  value={direction}
                  onValueChange={setDirection}
                  aria-label="Entry type"
                >
                  {["profit", "loss"].map((v) => (
                    <label
                      className={`choice-option ${direction === v ? "selected" : ""}`}
                      key={v}
                    >
                      <strong>{v === "profit" ? "Profit" : "Loss"}</strong>
                      <RadioGroupItem value={v} />
                    </label>
                  ))}
                </RadioGroup>
              </div>
              <label className="settings-form">
                Amount per member · USD
                <Input
                  type="number"
                  min="0.01"
                  step="0.01"
                  max="100000000"
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                  placeholder="0.00"
                  required
                />
              </label>
            </div>
            <div>
              <label className="control-label">Recipients</label>
              <RadioGroup
                className="choice-options pnl-modes"
                value={mode}
                onValueChange={(v) => {
                  setMode(v);
                  setSelected([]);
                }}
                aria-label="Recipients"
              >
                {[
                  ["single", "Single member"],
                  ["selected", "Selected members"],
                  ["all", "All active members"],
                ].map(([value, label]) => (
                  <label
                    className={`choice-option ${mode === value ? "selected" : ""}`}
                    key={value}
                  >
                    <strong>{label}</strong>
                    <RadioGroupItem value={value} />
                  </label>
                ))}
              </RadioGroup>
            </div>
            <div className="row-between pnl-review-row">
              <span>
                {count} {count === 1 ? "member" : "members"}{" "}
                {mode === "all" ? "in this batch" : "selected"}
                {mode === "all" ? " · Search does not limit this group." : ""}
              </span>
              <button className="button" disabled={busy || !count}>
                {busy ? "Preparing…" : "Review posting"}
                <Check size={16} />
              </button>
            </div>
          </form>
          <section className="panel analytics-records">
            <div className="panel-heading admin-filters">
              <form
                className="admin-search"
                onSubmit={(e) => {
                  e.preventDefault();
                  setQuery(search);
                  setPage(1);
                }}
              >
                <Input
                  placeholder="Search members"
                  aria-label="Search members"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                />
                <button className="icon-button" aria-label="Search">
                  <Search size={17} />
                </button>
              </form>
              {mode === "selected" && (
                <button
                  className="text-link"
                  onClick={() =>
                    setSelected((prev) =>
                      [
                        ...new Set([
                          ...prev,
                          ...data.rows.map((r) => r.user_id),
                        ]),
                      ].slice(0, 400),
                    )
                  }
                >
                  Select this page
                </button>
              )}
              {selected.length > 0 && (
                <button className="text-link" onClick={() => setSelected([])}>
                  Clear selection
                </button>
              )}
            </div>
            <div
              className={loading ? "records-loading" : ""}
              aria-busy={loading}
            >
              <DataTable
                headers={[
                  "Select",
                  "Member",
                  "Email",
                  "Cash balance",
                  "Available liquidity",
                ]}
                rows={data.rows.map((r) => [
                  <Checkbox
                    key="select"
                    checked={mode === "all" || selected.includes(r.user_id)}
                    disabled={mode === "all"}
                    onCheckedChange={(v) => select(r.user_id, v === true)}
                    aria-label={`Select ${r.display_name}, ${r.email || r.user_id}`}
                  />,
                  r.display_name,
                  r.email || "—",
                  money(r.balance_cents),
                  money(r.available_cents),
                ])}
                empty="No matching active members."
              />
            </div>
            <div className="pagination">
              <span>
                {data.total
                  ? `${(page - 1) * 25 + 1}–${Math.min(page * 25, data.total)} of ${data.total}`
                  : "0 members"}
              </span>
              <div>
                <button
                  className="button button-ghost button-small"
                  disabled={loading || page === 1}
                  onClick={() => setPage(page - 1)}
                >
                  Previous
                </button>
                <button
                  className="button button-ghost button-small"
                  disabled={loading || page * 25 >= data.total}
                  onClick={() => setPage(page + 1)}
                >
                  Next
                </button>
              </div>
            </div>
          </section>
        </>
      )}
      <AlertDialog
        open={!!review}
        onOpenChange={(v) => {
          if (!v && !busy) setReview(null);
        }}
      >
        <AlertDialogContent className="app-dialog">
          <AlertDialogHeader>
            <AlertDialogTitle>
              Confirm {review?.direction === "profit" ? "profit" : "loss"}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {review &&
                `${money(review.amountCents)} ${review.direction === "profit" ? "credited to" : "debited from"} each of ${review.count} ${review.count === 1 ? "member" : "members"}.`}
            </AlertDialogDescription>
          </AlertDialogHeader>
          {review && (
            <>
              <div className="pnl-confirm-total">
                <span>
                  Total {review.direction === "profit" ? "credit" : "debit"}
                </span>
                <strong>{money(review.totalCents)}</strong>
              </div>
              <div className="pnl-recipient-preview">
                {review.recipients.map((r, i) => (
                  <div key={i}>
                    <strong>{r.name}</strong>
                    <span>{r.email}</span>
                  </div>
                ))}
                {review.count > 5 && (
                  <p>And {review.count - 5} more members.</p>
                )}
              </div>
              <div className="pnl-confirm-actions">
                <AlertDialogCancel disabled={busy}>Back</AlertDialogCancel>
                <AlertDialogAction asChild>
                  <button
                    className="button"
                    disabled={busy}
                    onClick={(e) => {
                      e.preventDefault();
                      void apply();
                    }}
                  >
                    {busy ? "Posting…" : `Post ${review.direction}`}
                    <Check size={16} />
                  </button>
                </AlertDialogAction>
              </div>
            </>
          )}
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
