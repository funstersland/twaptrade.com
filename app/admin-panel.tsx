"use client";
import React, { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { ProfitLoss } from "./admin-profit-loss";
import { botFamilies } from "@/lib/bot-families";
import { defaultPreferences, validPreferences } from "@/lib/appearance";
import {
  Plus,
  ArrowUpRight,
  Search,
  Copy,
  RefreshCw,
  ShieldCheck,
  Check,
} from "lucide-react";
import { toast } from "sonner";
import {
  AppFrame,
  Heading,
  Metrics,
  DataTable,
  Status,
  Security,
  Appearance,
  ChoiceSelect,
  Confirm,
  requestJSON,
  money,
  date,
} from "./workspace-components";
import { useAppearance } from "./twap-ui";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import type { Account, AdminData, PlatformSettings } from "@/lib/models";
type Row = Record<string, unknown>;
type Editor = { type: "user" | "new-user" | "bot" | "deployment"; row: Row };
const str = (row: Row, key: string) => String(row[key] ?? "");
const num = (row: Row, key: string) => Number(row[key] ?? 0);
const titles: Record<string, [string, string]> = {
  "profit-loss": ["Profit / Loss.", "Post profit or loss to member accounts."],
  overview: ["The control room.", "A current view of your platform."],
  users: [
    "People & permissions.",
    "Manage member accounts, access, and roles.",
  ],
  bots: ["Bot catalog.", "Create and publish the bots available to members."],
  deployments: [
    "Deployment queue.",
    "Manage funded deployments and their allocations.",
  ],
  transactions: [
    "Transaction records.",
    "Account ledger entries, across every member.",
  ],
  holdings: [
    "Account holdings.",
    "Assets and recorded valuations across your platform.",
  ],
  referrals: ["Referrals.", "Every invitation that became an account."],
  audit: [
    "Audit log.",
    "A permanent record of account and administrative actions.",
  ],
  settings: [
    "Platform settings.",
    "Manage availability and member communications.",
  ],
  security: ["Your security.", "Protect your administrative account."],
};
const statuses: Record<string, string[]> = {
  users: ["all", "active", "suspended", "archived"],
  bots: ["all", "draft", "published", "archived"],
  deployments: ["all", "requested", "queued", "running", "rejected", "stopped"],
  transactions: ["all", "pending", "completed", "failed"],
};
export function AdminPanel({ section }: { section: string }) {
  const [data, setData] = useState<AdminData | null>(null),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [loading, setLoading] = useState(true),
    [revision, setRevision] = useState(0),
    [search, setSearch] = useState(""),
    [query, setQuery] = useState(""),
    [status, setStatus] = useState("all"),
    [family, setFamily] = useState("all"),
    [page, setPage] = useState(1),
    [editor, setEditor] = useState<Editor | null>(null),
    [confirm, setConfirm] = useState<{
      title: string;
      detail: string;
      payload: Row;
    } | null>(null),
    [resetLink, setResetLink] = useState(""),
    [resetMessage, setResetMessage] = useState("");
  const { setPrefs, setSessionAccent } = useAppearance();
  const initialized = useRef(false);
  const serial = useRef(0);
  async function load() {
    const seq = ++serial.current;
    try {
      const params = new URLSearchParams({
        view: section,
        page: String(page),
        q: query,
        status,
        family,
      });
      const result = await requestJSON<AdminData>(`/api/admin?${params}`);
      if (seq !== serial.current) return;
      setError("");
      setData(result);
      setRevision((value) => value + 1);
      setSessionAccent(result.sessionAccent);
      if (!initialized.current) {
        setPrefs({
          ...defaultPreferences,
          ...validPreferences(result.actor.preferences),
        });
        const url = new URL(location.href);
        if (url.searchParams.has("entry")) {
          url.searchParams.delete("entry");
          history.replaceState(null, "", url.pathname + url.search);
        }
        initialized.current = true;
      }
    } catch (e) {
      if (seq === serial.current) setError((e as Error).message);
    } finally {
      if (seq === serial.current) setLoading(false);
    }
  }
  useEffect(() => {
    // Fetch external account state; all React updates occur after the request.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
    return () => {
      serial.current++;
    };
  }, [section, page, query, status, family]);
  async function mutate(payload: Row) {
    setBusy(true);
    try {
      const result = await requestJSON<{
        resetPath?: string;
        message?: string;
      }>("/api/admin", payload);
      setEditor(null);
      setConfirm(null);
      if (result.resetPath) {
        setResetLink(location.origin + result.resetPath);
        setResetMessage(result.message || "This link expires in 30 minutes.");
      } else toast.success("Changes saved.");
      await load();
      return true;
    } catch (e) {
      toast.error((e as Error).message);
      return false;
    } finally {
      setBusy(false);
    }
  }
  function prompt(title: string, detail: string, payload: Row) {
    setConfirm({ title, detail, payload });
  }
  const allowed = (row: Row) =>
    data?.actor.role === "owner" || str(row, "role") === "user";
  function auditRows(rows: Row[]) {
    return rows.map((r) => [
      date(r.created_at),
      str(r, "email") || str(r, "actor_id"),
      <span key="action" className="mono">
        {str(r, "action")}
      </span>,
      <span key="target" className="mono record-id" title={str(r, "target_id")}>
        {str(r, "target_id")}
      </span>,
      <span key="details" className="audit-details">
        {str(r, "details") === "{}" ? "—" : str(r, "details")}
      </span>,
    ]);
  }
  function records(): { headers: string[]; rows: React.ReactNode[][] } {
    const rows = data?.rows || [];
    switch (section) {
      case "users":
        return {
          headers: [
            "Member",
            "Role",
            "Access",
            "Joined",
            "Referrals",
            "Deployments",
            "Manage",
          ],
          rows: rows.map((r) => [
            <span key="member">
              <strong>{str(r, "display_name")}</strong>
              <small>{str(r, "email") || "Email required"}</small>
            </span>,
            str(r, "role"),
            <Status key="s" value={str(r, "status")} />,
            date(r.created_at),
            num(r, "referrals"),
            num(r, "deployments"),
            <button
              key="edit"
              className="button button-ghost button-small"
              disabled={!allowed(r)}
              onClick={() => setEditor({ type: "user", row: r })}
            >
              Manage
              <ArrowUpRight size={14} />
            </button>,
          ]),
        };
      case "bots":
        return {
          headers: [
            "Bot",
            "Family",
            "Pair",
            "Minimum allocation",
            "Status",
            "Updated",
            "Manage",
          ],
          rows: rows.map((r) => [
            <span key="name">
              <strong>{str(r, "name")}</strong>
              <small className="truncate-copy">{str(r, "description")}</small>
            </span>,
            str(r, "family") || "Not assigned",
            str(r, "pair"),
            money(num(r, "min_allocation_cents")),
            <Status key="s" value={str(r, "status")} />,
            date(r.updated_at),
            <button
              key="edit"
              className="button button-ghost button-small"
              onClick={() => setEditor({ type: "bot", row: r })}
            >
              Edit
              <ArrowUpRight size={14} />
            </button>,
          ]),
        };
      case "deployments":
        return {
          headers: [
            "Member",
            "Bot",
            "Allocation",
            "Status",
            "Requested",
            "Review",
          ],
          rows: rows.map((r) => [
            str(r, "email"),
            <span key="b">
              <strong>{str(r, "name")}</strong>
              <small>
                {[str(r, "family"), str(r, "pair")].filter(Boolean).join(" · ")}
              </small>
            </span>,
            money(num(r, "allocation_cents")),
            <Status key="s" value={str(r, "status")} />,
            date(r.created_at),
            <button
              key="edit"
              className="button button-ghost button-small"
              disabled={!["requested", "queued"].includes(str(r, "status"))}
              onClick={() => setEditor({ type: "deployment", row: r })}
            >
              Review
              <ArrowUpRight size={14} />
            </button>,
          ]),
        };
      case "transactions":
        return {
          headers: [
            "Reference",
            "Member",
            "Type",
            "Asset",
            "Quantity",
            "USD amount",
            "Status",
            "Provider reference",
            "Date",
          ],
          rows: rows.map((r) => [
            <span key="id" className="mono record-id" title={str(r, "id")}>
              {str(r, "id")}
            </span>,
            str(r, "email"),
            str(r, "type"),
            str(r, "asset"),
            str(r, "quantity"),
            money(num(r, "amount_cents")),
            <Status key="s" value={str(r, "status")} />,
            str(r, "provider_ref") || "—",
            date(r.created_at),
          ]),
        };
      case "holdings":
        return {
          headers: ["Member", "Asset", "Quantity", "USD value", "Last updated"],
          rows: rows.map((r) => [
            str(r, "email"),
            str(r, "symbol"),
            str(r, "quantity"),
            r.value_cents === null
              ? "Awaiting valuation"
              : money(num(r, "value_cents")),
            date(r.updated_at),
          ]),
        };
      case "referrals":
        return {
          headers: ["Member", "Email", "Invited by", "Referral code", "Joined"],
          rows: rows.map((r) => [
            str(r, "display_name"),
            str(r, "email"),
            str(r, "referrer_email"),
            <span key="c" className="mono">
              {str(r, "referral_code")}
            </span>,
            date(r.created_at),
          ]),
        };
      default:
        return {
          headers: ["Time", "Actor", "Action", "Target", "Details"],
          rows: auditRows(rows),
        };
    }
  }
  const table = records();
  return (
    <AppFrame section={section} profile={data?.actor || null} admin>
      <Heading
        eyebrow="TWAPTRADE / ADMINISTRATION"
        title={titles[section][0]}
        detail={titles[section][1]}
      >
        {section === "users" && (
          <button
            className="button button-small"
            onClick={() => setEditor({ type: "new-user", row: {} })}
          >
            <Plus size={16} />
            Add user
          </button>
        )}
        {section === "bots" && (
          <button
            className="button button-small"
            onClick={() => setEditor({ type: "bot", row: {} })}
          >
            <Plus size={16} />
            Create bot
          </button>
        )}
        <button
          className="button button-ghost button-small"
          disabled={loading}
          onClick={() => {setLoading(true); void load();}}
          aria-label="Refresh records"
        >
          <RefreshCw size={16} />
        </button>
      </Heading>
      {error && (
        <div className="error-banner" role="alert">
          <span>{error}</span>
          <button onClick={() => {setLoading(true); void load();}}>Try again</button>
        </div>
      )}
      {loading && !data && (
        <div className="loading-state" role="status">
          Loading administration…
        </div>
      )}
      {data && (
        <>
          {section === "overview" && (
            <>
              <Metrics
                items={[
                  {
                    label: "Members",
                    value: data.summary.users,
                    detail: `${data.summary.admins} administrators`,
                  },
                  {
                    label: "Cash recorded",
                    value: money(data.summary.cash_balance),
                    detail: "Net confirmed ledger balance",
                  },
                  {
                    label: "Published bots",
                    value: data.summary.published_bots,
                  },
                  {
                    label: "Queued deployments",
                    value: data.summary.queued_deployments,
                    detail: `${data.summary.pending_deployments} awaiting review`,
                  },
                ]}
              />
              <div className="admin-overview-grid">
                <section className="panel">
                  <div className="panel-heading">
                    <h2>Platform connections</h2>
                    <ShieldCheck size={18} />
                  </div>
                  <div className="integration-list">
                    {[
                      ["Account access", true],
                      ["Database", true],
                      ["Trading execution", data.integrations.execution],
                      ["Wallet provider", data.integrations.wallet],
                      ["Email delivery", data.integrations.email],
                    ].map(([label, ready]) => (
                      <div className="row-between" key={String(label)}>
                        <span>{label}</span>
                        <Status value={ready ? "connected" : "not connected"} />
                      </div>
                    ))}
                  </div>
                </section>
                <section className="panel">
                  <div className="panel-heading">
                    <h2>Account activity</h2>
                  </div>
                  <div className="integration-list">
                    {[
                      ["Active sessions", data.summary.sessions],
                      ["Suspended accounts", data.summary.suspended],
                      ["Recorded transactions", data.summary.transactions],
                      ["Referrals", data.summary.referrals],
                    ].map(([label, value]) => (
                      <div className="row-between" key={label}>
                        <span>{label}</span>
                        <strong>{value}</strong>
                      </div>
                    ))}
                  </div>
                </section>
              </div>
              <section className="panel analytics-records">
                <div className="panel-heading">
                  <h2>Latest audit events</h2>
                  <Link href="/admin/audit" className="small-link">
                    View log
                    <ArrowUpRight size={14} />
                  </Link>
                </div>
                <DataTable
                  headers={["Time", "Actor", "Action", "Target", "Details"]}
                  rows={auditRows(data.rows)}
                />
              </section>
            </>
          )}
          {!["overview", "settings", "security", "profit-loss"].includes(
            section,
          ) && (
            <section className="panel admin-records">
              <div className="panel-heading admin-filters">
                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    setPage(1);
                    setQuery(search);
                  }}
                  className="admin-search"
                >
                  <Input
                    placeholder={`Search ${section}`}
                    aria-label={`Search ${section}`}
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                  />
                  <button className="icon-button" aria-label="Search">
                    <Search size={17} />
                  </button>
                </form>
                {section === "bots" && (
                  <ChoiceSelect
                    value={family}
                    onChange={(v) => {
                      setFamily(v);
                      setPage(1);
                    }}
                    options={["all", ...botFamilies]}
                    label="Filter by bot family"
                  />
                )}
                {statuses[section] && (
                  <ChoiceSelect
                    value={status}
                    onChange={(v) => {
                      setStatus(v);
                      setPage(1);
                    }}
                    options={statuses[section]}
                    label="Filter by status"
                  />
                )}
                <span className="small muted">{data.total} records</span>
              </div>
              <div
                aria-busy={loading}
                className={loading ? "records-loading" : ""}
              >
                <DataTable
                  headers={table.headers}
                  rows={table.rows}
                  empty={
                    query || status !== "all" || family !== "all"
                      ? "No matching records."
                      : "No records yet."
                  }
                />
              </div>
              <div className="pagination">
                <span>
                  {data.total
                    ? `${(page - 1) * data.pageSize + 1}–${Math.min(page * data.pageSize, data.total)} of ${data.total}`
                    : "0 records"}
                </span>
                <div>
                  <button
                    className="button button-ghost button-small"
                    disabled={page === 1 || loading}
                    onClick={() => setPage(page - 1)}
                  >
                    Previous
                  </button>
                  <button
                    className="button button-ghost button-small"
                    disabled={page * data.pageSize >= data.total || loading}
                    onClick={() => setPage(page + 1)}
                  >
                    Next
                  </button>
                </div>
              </div>
            </section>
          )}
          {section === "settings" && (
            <Tabs defaultValue="platform">
              <TabsList variant="line">
                <TabsTrigger value="platform">Platform</TabsTrigger>
                <TabsTrigger value="appearance">Appearance</TabsTrigger>
              </TabsList>
              <TabsContent value="platform">
                <PlatformForm
                  key={JSON.stringify(data.settings)}
                  settings={data.settings}
                  busy={busy}
                  save={(values) =>
                    mutate({ action: "save-settings", settings: values })
                  }
                />
              </TabsContent>
              <TabsContent value="appearance">
                <Appearance
                  save={async (values) => {
                    const result = await requestJSON<Account>("/api/account", {
                      action: "save",
                      ...values,
                    });
                    setData({ ...data, actor: result.profile });
                    return result;
                  }}
                />
              </TabsContent>
            </Tabs>
          )}
          {section === "security" && <Security profile={data.actor} />}
          {section === "profit-loss" && <ProfitLoss refreshKey={revision} />}
          {["transactions", "holdings"].includes(section) && (
            <p className="workspace-note">
              Funding and withdrawals are not connected.
            </p>
          )}
          {section === "deployments" && (
            <p className="workspace-note">
              Funded deployments remain queued until trading execution is
              connected.
            </p>
          )}
          <Dialog
            open={!!editor}
            onOpenChange={(v) => {
              if (!v && !busy) setEditor(null);
            }}
          >
            <DialogContent className="app-dialog admin-editor">
              <DialogHeader>
                <DialogTitle>
                  {editor?.type === "new-user"
                    ? "Add a member"
                    : editor?.type === "user"
                      ? "Manage account"
                      : editor?.type === "deployment"
                        ? "Review deployment"
                        : editor?.row.id
                          ? "Edit bot"
                          : "Create bot"}
                </DialogTitle>
                <DialogDescription>
                  {editor?.type === "new-user"
                    ? "Create an account and a secure password setup link."
                    : editor?.type === "user"
                      ? "Account access, profile details, and recovery."
                      : editor?.type === "deployment"
                        ? "Choose the next status and leave a note for the member."
                        : "Published bots appear in the member catalog. Trading logic will be connected separately."}
                </DialogDescription>
              </DialogHeader>
              {editor && (
                <EditorForm
                  key={
                    editor.type +
                    str(editor.row, "user_id") +
                    str(editor.row, "id")
                  }
                  editor={editor}
                  owner={data.actor.role === "owner"}
                  busy={busy}
                  save={async (payload) => {
                    if (
                      payload.action === "save-user" &&
                      (payload.status !== editor.row.status ||
                        payload.role !== editor.row.role ||
                        payload.email !== editor.row.email)
                    ) {
                      prompt(
                        "Update account access?",
                        "Access, role, or email changes will sign out this member’s active sessions.",
                        payload,
                      );
                    } else await mutate(payload);
                  }}
                />
              )}
              {editor?.type === "user" && (
                <div className="admin-user-actions">
                  <div className="muted small">
                    Account ID:{" "}
                    <span className="mono">{str(editor.row, "user_id")}</span>
                    <br />
                    Last sign-in: {date(editor.row.last_login_at)}
                  </div>
                  <button
                    className="button button-ghost button-small"
                    disabled={busy || editor.row.status !== "active"}
                    onClick={() =>
                      prompt(
                        "Issue a password reset link?",
                        "Existing unused reset links will be invalidated. Share the new link directly with the account holder.",
                        { action: "reset-password", id: editor.row.user_id },
                      )
                    }
                  >
                    Issue reset link
                  </button>
                  <button
                    className="button button-ghost button-small"
                    disabled={busy}
                    onClick={() =>
                      prompt(
                        "Revoke all sessions?",
                        "This account will be signed out of every browser immediately.",
                        { action: "revoke-sessions", id: editor.row.user_id },
                      )
                    }
                  >
                    Revoke sessions
                  </button>
                </div>
              )}
            </DialogContent>
          </Dialog>
          <Confirm
            open={!!confirm}
            onClose={() => setConfirm(null)}
            title={confirm?.title || ""}
            detail={confirm?.detail || ""}
            busy={busy}
            onConfirm={() => {
              if (confirm) void mutate(confirm.payload);
            }}
          />
          <Dialog
            open={!!resetLink}
            onOpenChange={(v) => {
              if (!v) setResetLink("");
            }}
          >
            <DialogContent className="app-dialog">
              <DialogHeader>
                <DialogTitle>Secure account link</DialogTitle>
                <DialogDescription>{resetMessage}</DialogDescription>
              </DialogHeader>
              <Input
                value={resetLink}
                readOnly
                aria-label="Secure password setup link"
                onFocus={(e) => e.currentTarget.select()}
              />
              <button
                className="button"
                onClick={async () => {
                  try {
                    await navigator.clipboard.writeText(resetLink);
                    toast.success("Link copied.");
                  } catch {
                    toast.error("Select the link and copy it manually.");
                  }
                }}
              >
                <Copy size={16} />
                Copy secure link
              </button>
            </DialogContent>
          </Dialog>
        </>
      )}
    </AppFrame>
  );
}
function EditorForm({
  editor,
  owner,
  busy,
  save,
}: {
  editor: Editor;
  owner: boolean;
  busy: boolean;
  save: (payload: Row) => Promise<unknown>;
}) {
  const { row, type } = editor;
  const [role, setRole] = useState(str(row, "role") || "user"),
    [family, setFamily] = useState(str(row, "family")),
    [status, setStatus] = useState(
      str(row, "status") || (type === "bot" ? "draft" : "active"),
    );
  const ownerAccount = row.role === "owner";
  return (
    <form
      className="settings-form"
      onSubmit={async (e) => {
        e.preventDefault();
        const form = new FormData(e.currentTarget);
        const get = (k: string) => String(form.get(k) || "");
        let payload: Row;
        if (type === "bot") {
          if (!botFamilies.some((value) => value === family)) {
            toast.error("Choose a bot family.");
            return;
          }
          const amount = get("minimum");
          if (!/^\d+(\.\d{1,2})?$/.test(amount)) {
            toast.error(
              "Use up to two decimal places for the minimum allocation.",
            );
            return;
          }
          payload = {
            action: "save-bot",
            ...(row.id ? { id: row.id } : {}),
            name: get("name"),
            family,
            pair: get("pair"),
            description: get("description"),
            status,
            minAllocationCents: Math.round(Number(amount) * 100),
          };
        } else if (type === "deployment") {
          payload = {
            action: "review-deployment",
            id: row.id,
            status: form.get("reviewStatus"),
            note: get("note"),
          };
        } else {
          payload = {
            action: type === "new-user" ? "create-user" : "save-user",
            name: get("name"),
            email: get("email"),
            role,
            ...(type === "user"
              ? { id: row.user_id, status, notes: get("notes") }
              : {}),
          };
        }
        await save(payload);
      }}
    >
      {(type === "user" || type === "new-user") && (
        <>
          <label>
            Full name
            <Input
              name="name"
              defaultValue={str(row, "display_name")}
              required
              maxLength={80}
            />
          </label>
          <label>
            Email address
            <Input
              name="email"
              type="email"
              defaultValue={str(row, "email")}
              readOnly={ownerAccount}
              required
              maxLength={254}
            />
          </label>
          <label>
            Role
            <ChoiceSelect
              value={role}
              onChange={setRole}
              label="Account role"
              options={ownerAccount ? ["owner"] : ["user", "admin"]}
              disabled={!owner || ownerAccount}
            />
          </label>
          {type === "user" && (
            <>
              <label>
                Account access
                <ChoiceSelect
                  value={status}
                  onChange={setStatus}
                  label="Account access"
                  options={["active", "suspended", "archived"]}
                  disabled={ownerAccount}
                />
                <small>
                  Suspending or archiving removes access and revokes sessions.
                  Records are retained.
                </small>
              </label>
              <label>
                Internal notes
                <Textarea
                  name="notes"
                  defaultValue={str(row, "notes")}
                  maxLength={2000}
                  rows={3}
                />
              </label>
            </>
          )}
        </>
      )}
      {type === "bot" && (
        <>
          <label>
            Bot family
            <ChoiceSelect
              value={family}
              onChange={setFamily}
              options={[...botFamilies]}
              label="Bot family"
              placeholder="Choose a family"
            />
          </label>
          <label>
            Bot name
            <Input
              name="name"
              defaultValue={str(row, "name")}
              minLength={2}
              maxLength={80}
              required
            />
          </label>
          <label>
            Trading pair
            <Input
              name="pair"
              defaultValue={str(row, "pair")}
              placeholder="Base / Quote"
              minLength={3}
              maxLength={30}
              required
            />
          </label>
          <label>
            Description
            <Textarea
              name="description"
              defaultValue={str(row, "description")}
              maxLength={2000}
              rows={4}
            />
          </label>
          <div className="form-columns">
            <label>
              Minimum allocation · USD
              <Input
                name="minimum"
                type="number"
                step="0.01"
                min={0}
                max={100000000}
                defaultValue={num(row, "min_allocation_cents") / 100}
                required
              />
            </label>
            <label>
              Visibility
              <ChoiceSelect
                value={status}
                onChange={setStatus}
                label="Bot visibility"
                options={["draft", "published", "archived"]}
              />
            </label>
          </div>
        </>
      )}
      {type === "deployment" && (
        <>
          <div className="info-banner">
            {str(row, "name")} · {money(num(row, "allocation_cents"))}
            <br />
            {str(row, "email")}
          </div>
          <ReviewStatus />
          <label>
            Note to member
            <Textarea
              name="note"
              defaultValue={str(row, "note")}
              maxLength={1000}
              rows={4}
            />
          </label>
        </>
      )}
      <button className="button" disabled={busy}>
        {busy
          ? "Saving…"
          : type === "new-user"
            ? "Create account & setup link"
            : "Save changes"}
        <Check size={16} />
      </button>
    </form>
  );
}
function ReviewStatus() {
  const [value, setValue] = useState("queued");
  return (
    <label>
      Decision
      <input type="hidden" name="reviewStatus" value={value} />
      <ChoiceSelect
        value={value}
        onChange={setValue}
        label="Deployment decision"
        options={["queued", "rejected", "stopped"]}
      />
      <small>Queued requests await an execution connection.</small>
    </label>
  );
}
function PlatformForm({
  settings,
  busy,
  save,
}: {
  settings: PlatformSettings;
  busy: boolean;
  save: (v: PlatformSettings) => Promise<unknown>;
}) {
  const [draft, setDraft] = useState(settings);
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        void save(draft);
      }}
    >
      <div className="settings-intro">
        <div>
          <h2>Platform controls</h2>
          <p>Changes apply to all members.</p>
        </div>
        <button className="button button-small" disabled={busy}>
          {busy ? "Saving…" : "Save settings"}
          <Check size={16} />
        </button>
      </div>
      <section className="setting-section">
        {(
          [
            {
              key: "registrationsOpen",
              title: "New registrations",
              detail: "Allow people to create accounts.",
            },
            {
              key: "deploymentsOpen",
              title: "User bot deployment",
              detail:
                "Allow users to deploy bots when their available balance meets the bot’s minimum allocation.",
            },
            {
              key: "referralsEnabled",
              title: "Referral invitations",
              detail: "Allow new accounts to join using referral links.",
            },
            {
              key: "maintenanceMode",
              title: "Maintenance mode",
              detail:
                "Pause member sign-ins, registration, and deployment changes. Administrators retain access.",
            },
          ] as const
        ).map((o) => (
          <div className="settings-toggle" key={o.key}>
            <div>
              <label htmlFor={o.key}>{o.title}</label>
              <p>{o.detail}</p>
            </div>
            <Switch
              id={o.key}
              checked={draft[o.key]}
              onCheckedChange={(v) => setDraft({ ...draft, [o.key]: v })}
            />
          </div>
        ))}
      </section>
      <section className="setting-section">
        <div className="setting-label">
          <h3>Member communications</h3>
          <p>Content shown inside the member workspace.</p>
        </div>
        <div className="settings-form">
          <label>
            Announcement
            <Textarea
              value={draft.announcement}
              onChange={(e) =>
                setDraft({ ...draft, announcement: e.target.value })
              }
              maxLength={500}
              rows={3}
            />
          </label>
          <label>
            Support email
            <Input
              type="email"
              value={draft.supportEmail}
              onChange={(e) =>
                setDraft({ ...draft, supportEmail: e.target.value })
              }
              maxLength={254}
            />
          </label>
          <label>
            Referral terms
            <Textarea
              value={draft.referralTerms}
              onChange={(e) =>
                setDraft({ ...draft, referralTerms: e.target.value })
              }
              maxLength={2000}
              rows={4}
            />
          </label>
        </div>
      </section>
    </form>
  );
}
