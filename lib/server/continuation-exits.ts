import { z } from "zod";
import { database } from "./db";
import { HttpError, json } from "./http";
import type { Round } from "../bots/crypto-shares/continuation/types";
const integer = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
export const fillSchema = z.object({
  id: z.string().regex(/^0x[0-9a-fA-F]{64}:\d+$/), orderId: z.string().regex(/^0x[0-9a-fA-F]{64}$/),
  side: z.enum(["BUY", "SELL"]), tokenId: z.string().regex(/^\d+$/),
  transactionHash: z.string().regex(/^0x[0-9a-fA-F]{64}$/), logIndex: integer, blockNumber: integer,
  grossMicros: integer.positive(), sharesMicros: integer.positive(), feeMicros: integer,
  cashMicros: integer.positive(), price: z.string().regex(/^\d+\.\d{1,18}$/), tradeIds: z.array(z.string().max(200)).max(200),
}).strict();
const base = {lease: z.string().uuid(), roundId: z.string().uuid(), orderId: z.string().min(1).max(200)};
export const exitSchemas = [
  z.object({...base, action: z.literal("exit-prepare"), sharesMicros: integer.positive(), walletSharesMicros: integer.positive(), stableSince: integer, observedAt: integer, bidMicros: integer.min(990000).max(1000000)}).strict(),
  z.object({...base, action: z.literal("exit-fill"), sharesMicros: integer.positive(), grossMicros: integer.positive(), feeMicros: integer, cashMicros: integer, fills: z.array(fillSchema).max(200).optional()}).strict(),
  z.object({...base, action: z.literal("exit-failed"), uncertain: z.boolean()}).strict(),
] as const;
const exitUnion = z.discriminatedUnion("action", exitSchemas);
type Exit = z.infer<typeof exitUnion>;
type Execution = z.infer<typeof fillSchema>;
export function fillStatement(f: Execution, roundId: string, iso: string) {
  return database().prepare("INSERT INTO continuation_fills (id,round_id,order_id,side,token_id,transaction_hash,log_index,block_number,gross_micros,shares_micros,fee_micros,cash_micros,price,trade_ids,confirmed_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO NOTHING")
    .bind(f.id, roundId, f.orderId, f.side, f.tokenId, f.transactionHash, f.logIndex, f.blockNumber, f.grossMicros, f.sharesMicros, f.feeMicros, f.cashMicros, f.price, JSON.stringify(f.tradeIds), iso);
}
export async function handleExit(input: Exit, round: Round & {mode:string}) {
  const db = database(), now = Date.now(), iso = new Date(now).toISOString();
  const remaining = round.shares_micros-round.sold_shares_micros;
  if (input.action === "exit-prepare") {
    const existing = await db.prepare("SELECT round_id,requested_shares_micros,status FROM continuation_orders WHERE id=?")
      .bind(input.orderId).first<{round_id:string;requested_shares_micros:number;status:string}>();
    if (existing) {
      if (existing.round_id === round.id && existing.requested_shares_micros === input.sharesMicros && existing.status === "prepared") return json({ok:true});
      throw new HttpError(409,"This exit reference is already recorded.");
    }
    if (round.status !== "open" || input.sharesMicros > input.walletSharesMicros || input.walletSharesMicros < remaining || (round.mode === "paper" && input.walletSharesMicros !== remaining) || now-input.stableSince < 5000 ||
      input.observedAt < now-1500 || input.observedAt > now || input.stableSince > input.observedAt ||
      now >= (round.start_seconds+300)*1000) throw new HttpError(409, "Exit price or owned quantity is no longer eligible.");
    if (round.mode === "live" && !/^0x[0-9a-fA-F]{64}$/.test(input.orderId)) throw new HttpError(400,"Signed order reference required.");
    const r = await db.prepare("INSERT INTO continuation_orders (id,round_id,side,status,requested_shares_micros,wallet_shares_micros,bot_shares_micros,limit_price,created_at,updated_at) SELECT ?,?,'SELL','prepared',?,?,?,'0.99',?,? WHERE EXISTS (SELECT 1 FROM continuation_rounds WHERE id=? AND status='open' AND shares_micros-sold_shares_micros>=?) AND NOT EXISTS (SELECT 1 FROM continuation_orders WHERE round_id=? AND status IN ('prepared','uncertain')) ON CONFLICT(id) DO NOTHING")
      .bind(input.orderId, round.id, input.sharesMicros, input.walletSharesMicros, Math.min(remaining,input.sharesMicros), iso, iso, round.id, Math.min(remaining,input.sharesMicros), round.id).run();
    if (!r.meta.changes) throw new HttpError(409,"An exit is already pending or this position changed.");
    return json({ok:true});
  }
  const order = await db.prepare("SELECT * FROM continuation_orders WHERE id=? AND round_id=?").bind(input.orderId,round.id).first<{status:string;requested_shares_micros:number;bot_shares_micros:number}>();
  if (!order) throw new HttpError(404,"Exit order not found.");
  if (["confirmed","unfilled"].includes(order.status)) return json({ok:true,alreadyRecorded:true});
  if (input.action === "exit-failed") {
    await db.prepare("UPDATE continuation_orders SET status=?,updated_at=? WHERE id=? AND status IN ('prepared','uncertain')").bind(input.uncertain?"uncertain":"unfilled",iso,input.orderId).run();
    if (input.uncertain) await db.prepare("UPDATE continuation_runs SET status='paused',message='Exit confirmation pending. New entries are paused.',updated_at=? WHERE id=?").bind(iso,round.run_id).run();
    return json({ok:true});
  }
  if (round.status !== "open" || input.sharesMicros > order.requested_shares_micros ||
    input.cashMicros !== input.grossMicros-input.feeMicros || BigInt(input.grossMicros)*100n < BigInt(input.sharesMicros)*99n)
    throw new HttpError(409,"Exit execution exceeds its recorded wallet quantity or price limit.");
  const fills = input.fills || [];
  if (round.mode === "live") {
    if (!fills.length || new Set(fills.map(f=>f.id)).size !== fills.length || fills.some(f=>f.side !== "SELL" || f.orderId !== input.orderId || f.tokenId !== round.token_id || f.cashMicros !== f.grossMicros-f.feeMicros || f.id !== `${f.transactionHash.toLowerCase()}:${f.logIndex}`))
      throw new HttpError(400,"Invalid sale executions.");
    for (const key of ["sharesMicros","grossMicros","feeMicros","cashMicros"] as const)
      if (fills.reduce((n,f)=>n+BigInt(f[key]),0n) !== BigInt(input[key])) throw new HttpError(400,"Sale execution totals differ.");
  } else if (fills.length) throw new HttpError(400,"Paper sales cannot contain live executions.");
  const ownShares = Math.min(remaining, order.bot_shares_micros, input.sharesMicros);
  const ownGross = Number(BigInt(input.grossMicros)*BigInt(ownShares)/BigInt(input.sharesMicros));
  const ownFee = Number(BigInt(input.feeMicros)*BigInt(ownShares)/BigInt(input.sharesMicros));
  const ownCash = ownGross-ownFee;
  const closed = ownShares === remaining;
  const pnl = round.sale_proceeds_micros+ownCash-round.cost_micros;
  const status = closed ? (pnl>0?"won":pnl<0?"lost":"breakeven") : "open";
  const gate = "EXISTS (SELECT 1 FROM continuation_orders WHERE id=? AND status IN ('prepared','uncertain'))";
  await db.batch([
    ...fills.map(f=>fillStatement(f,round.id,iso)),
    db.prepare(`UPDATE continuation_runs SET paper_cash_micros=paper_cash_micros+CASE WHEN mode='paper' THEN ? ELSE 0 END,loss_streak=CASE WHEN ?=1 THEN CASE WHEN ?<0 THEN loss_streak+1 ELSE 0 END ELSE loss_streak END,updated_at=? WHERE id=? AND ${gate}`)
      .bind(ownCash,closed?1:0,pnl,iso,round.run_id,input.orderId),
    db.prepare(`UPDATE continuation_rounds SET sold_shares_micros=sold_shares_micros+?,sale_proceeds_micros=sale_proceeds_micros+?,sale_fee_micros=sale_fee_micros+?,status=?,pnl_micros=?,exit_stable_since=NULL,mark_micros=NULL,reason=?,updated_at=? WHERE id=? AND ${gate}`)
      .bind(ownShares,ownCash,ownFee,status,closed?pnl:null,closed?"Sold at target":"Partial sale; remaining shares are tracked.",iso,round.id,input.orderId),
    db.prepare("UPDATE continuation_orders SET status='confirmed',filled_shares_micros=?,gross_micros=?,fee_micros=?,cash_micros=?,updated_at=? WHERE id=? AND status IN ('prepared','uncertain')").bind(input.sharesMicros,input.grossMicros,input.feeMicros,input.cashMicros,iso,input.orderId),
  ]);
  return json({ok:true});
}
