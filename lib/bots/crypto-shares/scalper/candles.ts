import { CANDLE_SECONDS } from "./identity.ts";
export type Tick = { at: number; value: string };
export type Candle = {
  start: number;
  end: number;
  seconds: number;
  open: string;
  high: string;
  low: string;
  close: string;
  firstAt: number;
  lastAt: number;
  complete: boolean;
};
export function toE18(value: string) {
  if (!/^\d+(\.\d{1,18})?$/.test(value)) throw Error("Invalid TWAP value");
  const [whole, fraction = ""] = value.split(".");
  return (
    BigInt(whole) * 10n ** 18n +
    BigInt(fraction.padEnd(18, "0"))
  ).toString();
}
export class CandleBook {
  closed: Candle[];
  private current = new Map<number, Candle>();
  private lastAt = 0;
  constructor(saved: Candle[] = []) {
    this.closed = saved.filter((c) => c.complete).slice(-640);
  }
  push(tick: Tick, receivedAt: number) {
    if (
      !Number.isSafeInteger(tick.at) ||
      tick.at <= this.lastAt ||
      tick.at > receivedAt + 500 ||
      receivedAt - tick.at > 3000 ||
      !/^\d{1,40}$/.test(tick.value) ||
      BigInt(tick.value) <= 0n
    )
      return false;
    this.lastAt = tick.at;
    for (const seconds of CANDLE_SECONDS) {
      const start = Math.floor(tick.at / (seconds * 1000)) * seconds * 1000;
      let candle = this.current.get(seconds);
      if (candle && candle.start !== start) {
        candle.complete &&=
          candle.end - candle.lastAt <= 3000 && tick.at - candle.lastAt <= 3000;
        this.closed.push(candle);
        candle = undefined;
      }
      if (!candle) {
        candle = {
          start,
          end: start + seconds * 1000,
          seconds,
          open: tick.value,
          high: tick.value,
          low: tick.value,
          close: tick.value,
          firstAt: tick.at,
          lastAt: tick.at,
          complete: tick.at - start <= 3000,
        };
      } else {
        candle.complete &&= tick.at - candle.lastAt <= 3000;
        candle.high =
          BigInt(tick.value) > BigInt(candle.high) ? tick.value : candle.high;
        candle.low =
          BigInt(tick.value) < BigInt(candle.low) ? tick.value : candle.low;
        candle.close = tick.value;
        candle.lastAt = tick.at;
      }
      this.current.set(seconds, candle);
    }
    this.closed = CANDLE_SECONDS.flatMap((seconds) =>
      this.closed.filter((c) => c.seconds === seconds).slice(-160),
    );
    return true;
  }
  snapshot() {
    return this.closed.map((c) => ({ ...c }));
  }
}
