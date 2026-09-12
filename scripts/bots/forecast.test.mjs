import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {analyze,entryWindow,nextEntryAt,quoteBuy,nextStake,zonesFromCandles} from '../../lib/bots/crypto-shares/forecast/rules.ts';
import {initialState,reduce,entryGate,commandSchema} from '../../lib/bots/crypto-shares/forecast/state.ts';
import {configSchema,DEFAULT_CONFIG} from '../../lib/bots/crypto-shares/forecast/config.ts';
import {parseKlines} from '../../lib/bots/crypto-shares/forecast/candles.ts';
import {parseMarket} from '../../lib/bots/crypto-shares/forecast/market.ts';
import {publicSnapshot,ForecastData} from './forecast-data.mjs';
import {forecastFixture,gammaFixture} from '../tests/forecast-fixtures.mjs';
const f=forecastFixture(),step=(s,c,t=f.now,ctx={})=>reduce(s,c,t,ctx).state;
function entered(f=forecastFixture()) {
 let s=initialState('paper'),id=randomUUID();
 s=step(s,{action:'arm',confirmVersion:1},f.now);
 const signal=analyze(f.candles,f.latest,f.market.horizon,f.now);
 s=step(s,{action:'prepare',market:f.market,direction:signal.direction,stakeCents:1000,orderId:null},f.now,{signal,positionId:id});
 s=step(s,{action:'submit',positionId:id},f.now);
 const quote=quoteBuy(f.book,1000,s.config,0.07,1,f.now);
 s=step(s,{action:'fill',positionId:id,costMicros:quote.costMicros,sharesMicros:quote.sharesMicros,feeMicros:quote.feeMicros,fills:[]},f.now);
 return {s,id,quote};
}
test('Forecast defaults: separate fixed-stake paper state and all three windows',()=>{
 const s=initialState('paper');assert.equal(s.armed,false);assert.deepEqual(s.config.horizons,[300,900,3600]);assert.equal(nextStake(s.config),1000);
 assert.equal(configSchema.safeParse({...DEFAULT_CONFIG,horizons:[]}).success,true);
 assert.equal(configSchema.safeParse({...DEFAULT_CONFIG,horizons:[300,300]}).success,false);
 assert.equal(configSchema.safeParse({...DEFAULT_CONFIG,martingale:true}).success,false);
});
test('Forecast combines all four closed frames and recognizes both candle directions in every window',()=>{
 for(const h of [300,900,3600])for(const side of ['Up','Down']){const v=forecastFixture(h,1789135200,side);const signal=analyze(v.candles,v.latest,h,v.now);assert.equal(signal.direction,side,signal.reason);assert.deepEqual(signal.frames.map(f=>f.seconds),[60,300,900,3600]);}
});
test('Forecast never uses open/future candles and rejects a missing latest frame, history gap or stale quote',()=>{
 const expected=analyze(f.candles,f.latest,300,f.now);
 assert.deepEqual(analyze([...f.candles,{...f.candles.at(-1),start:f.now,end:f.now+3600000,close:'1'}],f.latest,300,f.now),expected);
 assert.equal(analyze(f.candles.filter(c=>c.seconds!==3600),f.latest,300,f.now).direction,null);
 const gap=f.candles.filter((_,i)=>i!==10);assert.equal(analyze(gap,f.latest,300,f.now).direction,null);
 assert.equal(analyze(f.candles,{...f.latest,at:f.now-3001},300,f.now).direction,null);
 const noLatest=f.candles.filter(c=>c!==f.candles.filter(c=>c.seconds===900).at(-1));assert.match(analyze(noLatest,f.latest,300,f.now).reason,/latest closed/);
 assert.ok(zonesFromCandles(f.candles.filter(c=>c.seconds===60),1).every(z=>z.knownAt<=f.now));
});
test('Forecast strictly submits T-25 through before T-20, never current round or catchup',()=>{
 for(const h of [300,900,3600]){const target=f.target;assert.equal(entryWindow(target*1000-25000,target,h),true);assert.equal(entryWindow(target*1000-20001,target,h),true);for(const offset of [-25001,-20000,0,1000])assert.equal(entryWindow(target*1000+offset,target,h),false);assert.ok(nextEntryAt(target*1000-20000,h)>target*1000);}
});
test('Forecast window switches work while armed, preserve risk and cash, and never arm an idle bot',()=>{
 let s=step(initialState('paper'),{action:'window',horizon:300,enabled:false});assert.equal(s.armed,false);
 s=step(s,{action:'arm',confirmVersion:s.configVersion});const before=s.cashMicros;
 s=step(s,{action:'window',horizon:900,enabled:false});assert.equal(s.armed,true);assert.equal(s.cashMicros,before);assert.throws(()=>entryGate(s,f.market,f.now,false),/disabled/);
 for(const h of [300,900,3600])s=step(s,{action:'window',horizon:h,enabled:false});assert.deepEqual(s.config.horizons,[]);assert.throws(()=>entryGate(s,f.market,f.now,false),/disabled/);
 s=step(s,{action:'disarm'});assert.throws(()=>step(s,{action:'arm',confirmVersion:s.configVersion}),/Enable at least/);
 assert.equal(commandSchema.safeParse({action:'window',horizon:60,enabled:true}).success,false);
});
test('Forecast allows confirmed overlap, blocks unconfirmed orders, and retains resolution after window off',()=>{
 let {s,id}=entered();const next=forecastFixture(300,f.target+300);assert.equal(entryGate(s,next.market,next.now,false),1000);
 const uncertain={...s,positions:s.positions.map(p=>({...p,status:'uncertain'}))};assert.throws(()=>entryGate(uncertain,next.market,next.now,false),/unconfirmed/);
 s=step(s,{action:'window',horizon:300,enabled:false});assert.throws(()=>entryGate(s,next.market,next.now,false),/disabled/);
 s=step(s,{action:'resolve',positionId:id,winner:'Up'},f.market.end*1000);assert.equal(s.wins,1);assert.equal(s.positions.length,0);
});
test('Forecast accounting includes buy fees once and keeps settled drawdown and losing streak',()=>{
 let {s,id,quote}=entered();const before=s.cashMicros;s=step(s,{action:'resolve',positionId:id,winner:'Down'},f.market.end*1000);assert.equal(s.pnlMicros,-quote.costMicros);assert.equal(s.cashMicros,before);assert.equal(s.maxDrawdownMicros,quote.costMicros);assert.equal(s.maxLosingStreak,1);
 assert.throws(()=>step(s,{action:'resolve',positionId:id,winner:'Down'},f.market.end*1000));
 const won=entered();const state=step(won.s,{action:'resolve',positionId:won.id,winner:'Up'},f.market.end*1000);assert.equal(state.pnlMicros,won.quote.sharesMicros-won.quote.costMicros);assert.equal(state.maxWinningStreak,1);
});
test('Forecast executable depth, fees, minimum size and budget gate remain mandatory',()=>{
 assert.ok(quoteBuy(f.book,1000,DEFAULT_CONFIG,0.07,1,f.now));assert.equal(quoteBuy(f.book,100,DEFAULT_CONFIG,0.07,1,f.now),null);assert.equal(quoteBuy({...f.book,at:f.now-2001},1000,DEFAULT_CONFIG,0.07,1,f.now),null);
 assert.equal(quoteBuy({...f.book,asks:[{price:'.53',size:'1000'}]},1000,DEFAULT_CONFIG,0.07,1,f.now),null);
 const {s}=entered();s.config.dailyLossBp=100;assert.throws(()=>entryGate(s,forecastFixture(300,f.target+300).market,f.now+300000,false),/exposure/);
});
test('Forecast validates UTC boundaries and actual settlement metadata; proposed outcomes do not settle',()=>{
 for(const h of [300,900,3600]){const {market}=forecastFixture(h);const raw=gammaFixture(market);assert.equal(parseMarket(raw,market.start,h).winner,null);assert.throws(()=>parseMarket({...raw,eventStartTime:new Date((market.start+1)*1000).toISOString()},market.start,h));const resolved={...raw,closed:true,umaResolutionStatus:'resolved',outcomePrices:'["0","1"]'};assert.equal(parseMarket(resolved,market.start,h).winner,'Up');}
});
test('Forecast only accepts actually closed provider bars and fresh uncached responses',async()=>{
 const start=1789131600000,row=[start,'100','101','99','100.5','1',start+59999];assert.equal(parseKlines([row],60,start+59999).length,0);assert.equal(parseKlines([row],60,start+60000).length,1);assert.throws(()=>parseKlines([[start+1,...row.slice(1)]],60,start+60000));
 await assert.rejects(publicSnapshot('https://example.test',1500,async()=>new Response('{}',{headers:{age:'3'}})),/Fresh/);
 const r=await publicSnapshot('https://example.test',1500,async()=>new Response('{"bidPrice":"100"}'));assert.equal(r.value.bidPrice,'100');
 const data=new ForecastData(f.candles);assert.equal(data.latest,null);assert.equal(data.clockOK,false);
});
test('Forecast cannot submit a prepared order after its window is switched off',()=>{
 let s=step(initialState('paper'),{action:'arm',confirmVersion:1});const id=randomUUID();
 s=step(s,{action:'prepare',market:f.market,direction:'Up',stakeCents:1000,orderId:null},f.now,{signal:analyze(f.candles,f.latest,300,f.now),positionId:id});
 s=step(s,{action:'window',horizon:300,enabled:false});
 assert.throws(()=>step(s,{action:'submit',positionId:id}),/cannot be submitted/);
 assert.equal(s.positions.length,1);
});
