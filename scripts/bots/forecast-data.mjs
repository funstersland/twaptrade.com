import { CANDLE_SECONDS } from '../../lib/bots/crypto-shares/forecast/identity.ts';
import { parseKlines, toE18 } from '../../lib/bots/crypto-shares/forecast/candles.ts';
const origin='https://data-api.binance.vision';
export async function publicSnapshot(url, timeout=2500, fetcher=fetch) {
  const at=Date.now();
  const r=await fetcher(url,{cache:'no-store',headers:{'cache-control':'no-cache'},signal:AbortSignal.timeout(timeout)});
  if (!r.ok || Number(r.headers.get('age')||0)>0) throw Error('Fresh market snapshot unavailable');
  const value=await r.json();
  if (Date.now()-at>timeout) throw Error('Market snapshot arrived late');
  return {at,value};
}
export class ForecastData {
  constructor(saved=[]) {this.candles=saved;this.latest=null;this.clockAt=0;this.clockOK=false;}
  snapshot() { return this.candles; }
  async refresh() {
    const now=Date.now();
    if (now-this.clockAt>30000) {
      const t=await publicSnapshot(origin+'/api/v3/time');
      this.clockOK=Math.abs(Number(t.value.serverTime)-(t.at+Date.now())/2)<1000;
      this.clockAt=Date.now();
    }
    if (!this.clockOK) {this.latest=null;throw Error('BTC provider clock drift');}
    const results=await Promise.allSettled(CANDLE_SECONDS.map(async seconds=>{
      const boundary=Math.floor(now/(seconds*1000))*seconds*1000;
      const old=this.candles.filter(c=>c.seconds===seconds);
      if (old.length>=64 && old.at(-1).end===boundary) return;
      const interval=seconds===3600?'1h':`${seconds/60}m`;
      const r=await publicSnapshot(`${origin}/api/v3/klines?symbol=BTCUSDT&interval=${interval}&limit=65`);
      const bars=parseKlines(r.value,seconds,r.at).slice(-64);
      this.candles=[...this.candles.filter(c=>c.seconds!==seconds),...bars];
    }));
    // Missing intervals remain visible to analyze(); never fill holes with old prices.
    const q=await publicSnapshot(origin+'/api/v3/ticker/bookTicker?symbol=BTCUSDT',1500);
    if (q.value.symbol!=='BTCUSDT') throw Error('BTC quote identity changed');
    const bid=BigInt(toE18(q.value.bidPrice)),ask=BigInt(toE18(q.value.askPrice));
    if (bid<=0n || ask<bid || (ask-bid)*10000n>bid*5n) throw Error('BTC quote is crossed or spread exceeds 5bp');
    this.latest={at:q.at,value:((bid+ask)/2n).toString()};
    return results.every(r=>r.status==='fulfilled');
  }
}
