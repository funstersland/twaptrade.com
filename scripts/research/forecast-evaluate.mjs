// Public BTC spot proxy evaluation only. No account credentials or order API.
import fs from 'node:fs';
import { createHash } from 'node:crypto';
import { parseKlines } from '../../lib/bots/crypto-shares/forecast/candles.ts';
import { analyze } from '../../lib/bots/crypto-shares/forecast/rules.ts';
import { CANDLE_SECONDS, HORIZONS } from '../../lib/bots/crypto-shares/forecast/identity.ts';
const from=Date.parse('2026-08-01T00:00:00Z'),until=Date.parse('2026-09-12T00:00:00Z'),warm=from-72*3600000;
const cache='.sites-runtime/forecast-btc-1m.json';
fs.mkdirSync('.sites-runtime',{recursive:true});
let raw;
if (fs.existsSync(cache)) raw=JSON.parse(fs.readFileSync(cache));
else {
  const batches=[];
  for(let start=warm;start<until;start+=1000*60000) batches.push(start);
  raw=[];
  for(let i=0;i<batches.length;i+=4){
    const parts=await Promise.all(batches.slice(i,i+4).map(async start=>{
      const r=await fetch(`https://data-api.binance.vision/api/v3/klines?symbol=BTCUSDT&interval=1m&startTime=${start}&endTime=${until-1}&limit=1000`,{signal:AbortSignal.timeout(15000)});
      if(!r.ok) throw Error(`BTC history HTTP ${r.status}`);
      return r.json();
    }));
    raw.push(...parts.flat());
  }
  fs.writeFileSync(cache,JSON.stringify(raw));
}
const minutes=parseKlines(raw,60,until),maps=new Map();
if(minutes.some((m,i)=>i>0 && minutes[i-1].end!==m.start)) throw Error('Historical data gap');
for(const seconds of CANDLE_SECONDS){
  const grouped=new Map();
  for(const c of minutes){const start=Math.floor(c.start/(seconds*1000))*seconds*1000; if(!grouped.has(start))grouped.set(start,[]); grouped.get(start).push(c);}
  const frames=[];
  for(const [start,bars] of grouped){if(bars.length!==seconds/60)continue;frames.push({...bars[0],start,end:start+seconds*1000,seconds,high:bars.reduce((v,c)=>BigInt(c.high)>BigInt(v)?c.high:v,bars[0].high),low:bars.reduce((v,c)=>BigInt(c.low)<BigInt(v)?c.low:v,bars[0].low),close:bars.at(-1).close,lastAt:bars.at(-1).lastAt});}
  maps.set(seconds,frames);
}
const results=[];
for(const horizon of HORIZONS){
  const indexes=new Map(CANDLE_SECONDS.map(s=>[s,0])), labels=new Map(maps.get(horizon).map(c=>[c.start,c]));
  let wins=0,losses=0,winStreak=0,lossStreak=0,maxWins=0,maxLosses=0,eligible=0;
  const skips={},weeks={},trades=[];
  for(let target=from;target+horizon*1000<=until;target+=horizon*1000){
    const now=target-25000,bars=[];eligible++;
    for(const seconds of CANDLE_SECONDS){const arr=maps.get(seconds);let i=indexes.get(seconds);while(i<arr.length && arr[i].end<=now)i++;indexes.set(seconds,i);bars.push(...arr.slice(Math.max(0,i-64),i));}
    const last=bars.filter(c=>c.seconds===60).at(-1);
    // Historical minute bars cannot reproduce the T-25 live quote: last closed price is explicitly a proxy.
    const signal=analyze(bars,{at:now,value:last.close},horizon,now);
    if(!signal.direction){const key=signal.reason.split(':')[0];skips[key]=(skips[key]||0)+1;continue;}
    const candle=labels.get(target);if(!candle)throw Error('Missing outcome');
    const winner=BigInt(candle.close)>=BigInt(candle.open)?'Up':'Down',win=signal.direction===winner;
    if(win){wins++;winStreak++;lossStreak=0;}else{losses++;lossStreak++;winStreak=0;}
    maxWins=Math.max(maxWins,winStreak);maxLosses=Math.max(maxLosses,lossStreak);
    const week=Math.floor((target-from)/(7*86400000))+1;weeks[week]??={wins:0,losses:0};weeks[week][win?'wins':'losses']++;
    trades.push({target,direction:signal.direction,winner,score:signal.score});
  }
  const n=wins+losses,p=n?wins/n:0,z=1.96,den=1+z*z/n,center=(p+z*z/(2*n))/den,half=z*Math.sqrt(p*(1-p)/n+z*z/(4*n*n))/den;
  results.push({horizon,eligible,trades:n,wins,losses,winRate:p,wilson95:[center-half,center+half],maxWinningStreak:maxWins,maxLosingStreak:maxLosses,coverage:n/eligible,weeks,skips,tradeDigest:createHash('sha256').update(JSON.stringify(trades)).digest('hex')});
}
const report={from:new Date(from).toISOString(),until:new Date(until).toISOString(),source:'Binance BTCUSDT 1m klines',minutes:minutes.length,dataSha256:createHash('sha256').update(JSON.stringify(raw)).digest('hex'),strategySha256:createHash('sha256').update(fs.readFileSync('lib/bots/crypto-shares/forecast/rules.ts')).digest('hex'),limitations:['Spot candle direction, not Chainlink TWAP outcomes','T-25 tick, Polymarket quotes, fees, fills and exposure gates not replayed','No parameter search or refit; fixed first specification','Wilson intervals assume independent trials; overlapping horizons and serial dependence weaken them'],results};
fs.mkdirSync('docs/research',{recursive:true});fs.writeFileSync('docs/research/forecast-proxy-results.json',JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify(report,null,2));
