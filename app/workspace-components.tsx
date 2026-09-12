"use client";
import React, { useState } from "react";
import Link from "next/link";
import {
  LayoutDashboard,
  Wallet,
  ArrowLeftRight,
  Bot,
  ChartNoAxesCombined,
  Settings,
  Gift,
  Users,
  ClipboardList,
  ShieldCheck,
  LogOut,
  ChevronRight,
  Check,
  Palette,
  Eye,
  EyeOff,
  Activity,
} from "lucide-react";
import { Logo, useAppearance } from "./twap-ui";
import {
  Sidebar,
  SidebarProvider,
  SidebarHeader,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarMenu,
  SidebarMenuItem,
  SidebarMenuButton,
  SidebarInset,
  SidebarTrigger,
  useSidebar,
} from "@/components/ui/sidebar";
import {
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
} from "@/components/ui/table";
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogCancel,
  AlertDialogAction,
} from "@/components/ui/alert-dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { toast, Toaster } from "sonner";
import type { Profile } from "@/lib/models";
export async function requestJSON<T = Record<string, unknown>>(
  url: string,
  payload?: unknown,
): Promise<T> {
  const r = await fetch(
    url,
    payload
      ? {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        }
      : { cache: "no-store" },
  );
  const d = (await r.json()) as { error?: string };
  if (!r.ok) {
    if (r.status === 401) window.location.assign("/login");
    throw new Error(d.error || "This request could not be completed.");
  }
  return d as T;
}
export const money = (cents: number) =>
  new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(
    cents / 100,
  );
export const date = (v: unknown) =>
  v
    ? new Date(String(v)).toLocaleString(undefined, {
        dateStyle: "medium",
        timeStyle: "short",
      })
    : "—";
export function Status({ value }: { value: string }) {
  return (
    <span
      className={`status ${["active", "published", "completed"].includes(value) ? "positive" : ["suspended", "rejected", "failed"].includes(value) ? "negative" : "neutral"}`}
    >
      {value.replaceAll("_", " ")}
    </span>
  );
}
export function Heading({
  eyebrow,
  title,
  detail,
  children,
}: {
  eyebrow: string;
  title: string;
  detail?: string;
  children?: React.ReactNode;
}) {
  return (
    <div className="page-heading">
      <div>
        <span className="eyebrow">{eyebrow}</span>
        <h1>{title}</h1>
        {detail && <p>{detail}</p>}
      </div>
      {children && <div className="page-actions">{children}</div>}
    </div>
  );
}
export function Empty({ title, detail }: { title: string; detail?: string }) {
  return (
    <div className="real-empty">
      <Activity size={24} />
      <h3>{title}</h3>
      {detail && <p>{detail}</p>}
    </div>
  );
}
export function Metrics({
  items,
}: {
  items: { label: string; value: string | number; detail?: string }[];
}) {
  return (
    <div className="metrics-grid">
      {items.map((m, i) => (
        <section
          className={`metric ${i === 0 ? "metric-main" : ""}`}
          key={m.label}
        >
          <div className="metric-top">
            <span>{m.label}</span>
          </div>
          <h2>{m.value}</h2>
          <p className="muted small">{m.detail}</p>
        </section>
      ))}
    </div>
  );
}
export function DataTable({
  headers,
  rows,
  empty = "No records yet.",
}: {
  headers: string[];
  rows: React.ReactNode[][];
  empty?: string;
}) {
  return rows.length ? (
    <Table className="data-table">
      <TableHeader>
        <TableRow>
          {headers.map((h) => (
            <TableHead key={h}>{h}</TableHead>
          ))}
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((row, i) => (
          <TableRow key={i}>
            {row.map((cell, j) => (
              <TableCell key={j}>{cell}</TableCell>
            ))}
          </TableRow>
        ))}
      </TableBody>
    </Table>
  ) : (
    <Empty title={empty} />
  );
}
export function ChoiceSelect({
  value,
  onChange,
  options,
  label,
  disabled = false,
  placeholder = "Choose an option",
}: {
  value: string;
  onChange: (v: string) => void;
  options: string[];
  label: string;
  disabled?: boolean;
  placeholder?: string;
}) {
  return (
    <Select value={value} onValueChange={onChange} disabled={disabled}>
      <SelectTrigger aria-label={label}>
        <SelectValue placeholder={placeholder} />
      </SelectTrigger>
      <SelectContent>
        {options.map((o) => (
          <SelectItem key={o} value={o}>
            {o.charAt(0).toUpperCase() + o.slice(1).replaceAll("_", " ")}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
export function Confirm({
  open,
  onClose,
  onConfirm,
  title,
  detail,
  busy = false,
}: {
  open: boolean;
  onClose: () => void;
  onConfirm: () => void;
  title: string;
  detail: string;
  busy?: boolean;
}) {
  return (
    <AlertDialog
      open={open}
      onOpenChange={(v) => {
        if (!v && !busy) onClose();
      }}
    >
      <AlertDialogContent className="app-dialog">
        <AlertDialogHeader>
          <AlertDialogTitle>{title}</AlertDialogTitle>
          <AlertDialogDescription>{detail}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={busy}>Cancel</AlertDialogCancel>
          <AlertDialogAction
            disabled={busy}
            onClick={(e) => {
              e.preventDefault();
              onConfirm();
            }}
          >
            {busy ? "Working…" : "Confirm"}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
const userNav = [
  ["dashboard", "Dashboard", LayoutDashboard],
  ["wallet", "Wallet", Wallet],
  ["transactions", "Transactions", ArrowLeftRight],
  ["bots", "Bots", Bot],
  ["analytics", "Analytics", ChartNoAxesCombined],
] as const;
const adminNav = [
  ["overview", "Overview", LayoutDashboard],
  ["users", "Users", Users],
  ["bots", "Bot catalog", Bot],
  ["deployments", "Deployments", ClipboardList],
  ["transactions", "Transactions", ArrowLeftRight],
  ["profit-loss", "Profit / Loss", ChartNoAxesCombined],
  ["holdings", "Holdings", Wallet],
  ["referrals", "Referrals", Gift],
  ["audit", "Audit log", Activity],
] as const;
async function logout() {
  try {
    await requestJSON("/api/auth", { action: "logout" });
    window.location.assign("/login");
  } catch (e) {
    toast.error((e as Error).message);
  }
}
function Navigation({
  section,
  profile,
  admin,
}: {
  section: string;
  profile: Profile | null;
  admin: boolean;
}) {
  const { setOpenMobile } = useSidebar();
  const root = admin ? "/admin" : "/app";
  function navItem(id: string, label: string, Icon: typeof Settings) {
    return (
      <SidebarMenuItem key={id}>
        <SidebarMenuButton
          asChild
          isActive={section === id}
          className="app-nav-link"
        >
          <Link
            href={`${root}/${id}`}
            onClick={() => setOpenMobile(false)}
            aria-current={section === id ? "page" : undefined}
          >
            <Icon size={18} />
            <span>{label}</span>
          </Link>
        </SidebarMenuButton>
      </SidebarMenuItem>
    );
  }
  return (
    <Sidebar className="app-sidebar">
      <SidebarHeader>
        <div className="sidebar-brand">
          <Logo />
        </div>
        <div className="workspace-switch">
          <span className="workspace-initial">{admin ? "A" : "T"}</span>
          <span>
            {admin ? "Administration" : "Your workspace"}
            <small>{admin ? "Platform control" : "Personal account"}</small>
          </span>
        </div>
      </SidebarHeader>
      <SidebarContent>
        <SidebarGroup>
          <div className="sidebar-label">
            {admin ? "MANAGEMENT" : "WORKSPACE"}
          </div>
          <SidebarMenu>
            {(admin ? adminNav : userNav).map(([id, label, Icon]) =>
              navItem(id, label, Icon),
            )}
          </SidebarMenu>
        </SidebarGroup>
      </SidebarContent>
      <SidebarFooter>
        <SidebarMenu>
          {!admin && navItem("referrals", "Referrals", Gift)}
          {navItem("settings", "Settings", Settings)}
          {admin && navItem("security", "Security", ShieldCheck)}
          {profile && ["admin", "owner"].includes(profile.role) && (
            <SidebarMenuItem>
              <SidebarMenuButton asChild className="app-nav-link">
                <Link href={admin ? "/app/dashboard" : "/admin/overview"}>
                  <ShieldCheck size={18} />
                  {admin ? "Member workspace" : "Administration"}
                </Link>
              </SidebarMenuButton>
            </SidebarMenuItem>
          )}
        </SidebarMenu>
        <div className="sidebar-user">
          <span className="avatar">
            {profile?.name.slice(0, 2).toUpperCase() || "—"}
          </span>
          <span>
            <strong>{profile?.name || "Loading…"}</strong>
            <small>{profile?.role || "Account"}</small>
          </span>
          <button aria-label="Sign out" onClick={() => void logout()}>
            <LogOut size={16} />
          </button>
        </div>
      </SidebarFooter>
    </Sidebar>
  );
}
export function AppFrame({
  section,
  profile,
  admin = false,
  children,
}: {
  section: string;
  profile: Profile | null;
  admin?: boolean;
  children: React.ReactNode;
}) {
  return (
    <>
      <SidebarProvider
        style={{ "--sidebar-width": "235px" } as React.CSSProperties}
        className={`trading-app ${admin ? "admin-app" : ""}`}
      >
        <Navigation section={section} profile={profile} admin={admin} />
        <SidebarInset className="workspace">
          <header className="workspace-header">
            <div className="workspace-breadcrumb">
              <SidebarTrigger />
              <span>{admin ? "Administration" : "Workspace"}</span>
              <ChevronRight size={13} />
              <strong>
                {section.charAt(0).toUpperCase() + section.slice(1)}
              </strong>
            </div>
            <div className="workspace-header-right">
              <Link
                href={admin ? "/admin/security" : "/app/settings"}
                className="avatar"
                aria-label="Account settings"
              >
                {profile?.name.slice(0, 2).toUpperCase() || "—"}
              </Link>
            </div>
          </header>
          <div className="workspace-body">{children}</div>
        </SidebarInset>
      </SidebarProvider>
      <Toaster position="bottom-right" theme="system" richColors />
    </>
  );
}
export function Appearance({
  save,
}: {
  save: (values: Record<string, unknown>) => Promise<unknown>;
}) {
  const { prefs, setPrefs } = useAppearance();
  const [busy, setBusy] = useState(false);
  async function sync() {
    setBusy(true);
    try {
      await save({ preferences: prefs });
      toast.success("Appearance saved to your account.");
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <div className="settings-intro">
        <div>
          <h2>Your workspace, your signature.</h2>
          <p>Across your logo, charts, and every detail.</p>
        </div>
        <button className="button button-small" onClick={sync} disabled={busy}>
          {busy ? "Saving…" : "Save appearance"}
          <Check size={16} />
        </button>
      </div>
      {(
        [
          {
            key: "theme",
            label: "Theme",
            detail: "Find your focus, day or night.",
            values: ["dark", "light", "system"],
          },
          {
            key: "accent",
            label: "Accent color",
            detail:
              "Auto uses one color for your whole session and changes it at your next login.",
            values: ["auto", "mint", "sky", "amber", "rose"],
          },
          {
            key: "density",
            label: "Layout density",
            detail: "Choose more space or a closer view.",
            values: ["comfortable", "compact"],
          },
          {
            key: "motion",
            label: "Motion",
            detail:
              "Your device’s reduced-motion preference is always respected.",
            values: ["full", "reduced"],
          },
        ] as const
      ).map((group) => (
        <section className="setting-section" key={group.key}>
          <div className="setting-label">
            <h3>{group.label}</h3>
            <p>{group.detail}</p>
          </div>
          <RadioGroup
            className={
              group.key === "accent"
                ? "accent-options"
                : `choice-options ${group.key === "theme" ? "theme-choice-options" : ""}`
            }
            aria-label={group.label}
            value={prefs[group.key]}
            onValueChange={(v) => setPrefs({ [group.key]: v })}
          >
            {group.values.map((v) => (
              <label
                key={v}
                className={`${group.key === "accent" ? "accent-option" : "choice-option"} ${prefs[group.key] === v ? "selected" : ""}`}
              >
                {group.key === "accent" &&
                  (v === "auto" ? (
                    <span className="auto-swatches">
                      {["mint", "sky", "amber", "rose"].map((c) => (
                        <i className={`swatch ${c}`} key={c} />
                      ))}
                    </span>
                  ) : (
                    <span className={`swatch ${v}`} />
                  ))}
                <strong>{v.charAt(0).toUpperCase() + v.slice(1)}</strong>
                <RadioGroupItem value={v} />
              </label>
            ))}
          </RadioGroup>
        </section>
      ))}
    </>
  );
}
export function Security({ profile }: { profile: Profile }) {
  const [show, setShow] = useState(false),
    [busy, setBusy] = useState(false),
    [confirm, setConfirm] = useState(false);
  async function change(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget,
      values = new FormData(form);
    if (values.get("password") !== values.get("confirmation")) {
      toast.error("Your new passwords don’t match.");
      return;
    }
    setBusy(true);
    try {
      await requestJSON("/api/auth", {
        action: "change-password",
        currentPassword: values.get("currentPassword"),
        password: values.get("password"),
      });
      form.reset();
      toast.success("Password updated. Other sessions have been signed out.");
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <section className="setting-section">
        <div className="setting-label">
          <h3>Change password</h3>
          <p>Use a unique password with at least 12 characters.</p>
        </div>
        <form className="settings-form" onSubmit={change}>
          <label>
            Current password
            <div className="password-input">
              <Input
                name="currentPassword"
                type={show ? "text" : "password"}
                autoComplete="current-password"
                required
                maxLength={128}
              />
              <button
                type="button"
                aria-label={show ? "Hide passwords" : "Show passwords"}
                onClick={() => setShow(!show)}
              >
                {show ? <EyeOff size={16} /> : <Eye size={16} />}
              </button>
            </div>
          </label>
          <label>
            New password
            <Input
              name="password"
              type={show ? "text" : "password"}
              autoComplete="new-password"
              minLength={12}
              maxLength={128}
              required
            />
          </label>
          <label>
            Confirm new password
            <Input
              name="confirmation"
              type={show ? "text" : "password"}
              autoComplete="new-password"
              minLength={12}
              maxLength={128}
              required
            />
          </label>
          <button className="button" disabled={busy}>
            {busy ? "Updating…" : "Update password"}
            <ShieldCheck size={16} />
          </button>
        </form>
      </section>
      <section className="setting-section">
        <div className="setting-label">
          <h3>Account sessions</h3>
          <p>Last sign-in: {date(profile.lastLoginAt)}</p>
        </div>
        <button
          className="button button-ghost"
          onClick={() => setConfirm(true)}
        >
          Sign out other sessions
          <LogOut size={16} />
        </button>
      </section>
      <Confirm
        open={confirm}
        onClose={() => setConfirm(false)}
        title="Sign out other sessions?"
        detail="Other browsers signed into your account will need to log in again. This browser will stay signed in."
        busy={busy}
        onConfirm={async () => {
          setBusy(true);
          try {
            await requestJSON("/api/auth", { action: "revoke-other-sessions" });
            setConfirm(false);
            toast.success("Other sessions signed out.");
          } catch (e) {
            toast.error((e as Error).message);
          } finally {
            setBusy(false);
          }
        }}
      />
    </>
  );
}
