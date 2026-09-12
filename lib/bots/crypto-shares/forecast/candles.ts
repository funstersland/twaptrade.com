export type Tick = { at: number; value: string };
export type Candle = { start: number; end: number; seconds: number; open: string; high: string; low: string; close: string; firstAt: number; lastAt: number; complete: boolean };
export function toE18(value: string) {
  if (!/^\d+(\.\d{1,18})?$/.test(value)) throw Error("Invalid BTC price");
  const [whole, fraction=""] = value.split(".");
  return (BigInt(whole)*10n**18n + BigInt(fraction.padEnd(18,"0"))).toString();
}
// Provider klines include an inclusive close time; our interval end is exclusive.
export function parseKlines(raw: unknown, seconds: number, observedAt: number): Candle[] {
  if (!Array.isArray(raw)) throw Error("Invalid BTC candle response");
  return raw.map((row: unknown) => {
    if (!Array.isArray(row) || row.length<7) throw Error("Invalid BTC candle");
    const start=Number(row[0]),end=Number(row[6])+1;
    const [open,high,low,close]=row.slice(1,5).map(v=>toE18(String(v)));
    if (!Number.isSafeInteger(start) || start%(seconds*1000)!==0 || end!==start+seconds*1000 || BigInt(low)<=0n || BigInt(low)>BigInt(open) || BigInt(low)>BigInt(close) || BigInt(high)<BigInt(open) || BigInt(high)<BigInt(close)) throw Error("BTC candle identity/price mismatch");
    return {start,end,seconds,open,high,low,close,firstAt:start,lastAt:end-1,complete:true};
  }).filter(c=>c.end<=observedAt).sort((a,b)=>a.start-b.start);
}
