import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { DEFAULT_CONFIG, configSchema } from "../../lib/bots/crypto-shares/cheapshare/config.ts";
import { scan, entryPlan, exitPlan, stake, buyQuote, sellQuote, held, riskAllowed } from "../../lib/bots/crypto-shares/cheapshare/rules.ts";
import { priceArea, bucketProjection } from "../../lib/bots/crypto-shares/cheapshare/bucket.ts";
import { initialState, reduce, exitSignal, canEnter } from "../../lib/bots/crypto-shares/cheapshare/state.ts";
import { Feeds, parseMarket } from "./cheapshare-market.mjs";
import { reversalFixture, f } from "../tests/cheapshare-fixtures.mjs";
const fixture = reversalFixture();
const {now, market:m} = fixture;
const observation = () => structuredClone(fixture.observation);
const evaluate = (i=observation(),config=structuredClone(DEFAULT_CONFIG)) => scan({...i,config,preset:config.presets['BTC:300']});
function entered() {
  const id=randomUUID(),orderId=randomUUID();
  let s=reduce(initialState('paper'),{action:'arm',confirmVersion:null},now).state;
  s=reduce(s,{action:'entry',positionId:id,orderId,market:m,observation:observation()},now).state;
  s=reduce(s,{action:'submit',positionId:id,orderId},now).state;
  const q=buyQuote(observation().up.asks,s.positions[0].stake,s.positions[0].order.limit,m.feeRate,m.feeExponent);
  const fill={...q,id:`paper:${orderId}`,orderId,side:'BUY',tokenId:m.upToken,transactionHash:null,logIndex:0,blockNumber:0,tradeIds:[]};
  s=reduce(s,{action:'fill',positionId:id,orderId,fills:[fill]},now).state;
  return {s,id,fill};
}

test('replacement starts paper, ARM off, all twelve markets; retired configuration is rejected',()=>{
 const s=initialState('paper');assert.equal(s.armed,false);assert.equal(s.strategyVersion,2);
 assert.equal(Object.keys(s.config.presets).length,12);assert(!('setupB' in s.config));assert(!('martingale' in s.config));
 assert.throws(()=>configSchema.parse({...DEFAULT_CONFIG,setupB:true}));
 assert.throws(()=>reduce({...s,strategyVersion:1},{action:'arm',confirmVersion:null},now),/retired/);
});
test('minus two to plus ten qualifies with sufficient time and liquidity, even at 50 cents',()=>{
 const r=evaluate();assert.equal(r.eligible,true,JSON.stringify(r));assert.equal(r.side,'Up');
 const p=entryPlan(DEFAULT_CONFIG,observation().up,stake(DEFAULT_CONFIG),m.feeRate,m.feeExponent);
 assert(p.ok,p.reason);assert.equal(p.limit,0.50);
});
test('late 76900 to 77004 jump cannot overcome the cold bucket',()=>{
 const i=reversalFixture(now,76900,77004).observation;i.end=now+5000;
 assert.equal(evaluate(i).eligible,false);assert(BigInt(evaluate(i).projection)<BigInt(i.strike));
});
test('minus two to plus ten also fails when only five seconds remain',()=>{
 const i=observation();i.end=now+5000;const r=evaluate(i);assert.equal(r.eligible,false);assert(BigInt(r.projection)<BigInt(i.strike));
});
test('Down reversal is symmetric',()=>{
 const i=reversalFixture(now,77002,76990).observation;const r=evaluate(i);assert.equal(r.eligible,true,JSON.stringify(r));assert.equal(r.side,'Down');
});
test('a drift already beyond the strike and a tiny crossing are not sudden reversal entries',()=>{
 const drift=observation();drift.spot=drift.spot.map(p=>({...p,bid:f(77010),ask:f(77010)}));assert(!evaluate(drift).eligible);
 const tiny=reversalFixture(now,76998,77000.1).observation;assert(!evaluate(tiny).eligible);
});
test('mid-round start, missing reference, stale prices and future books block entries',()=>{
 for(const mutate of [i=>i.watchingSince=now-10000,i=>i.watchingSince=null,i=>i.strike=null,
 i=>i.up.at=now-4000,i=>i.down.at=now+1000,i=>i.spot.at(-1).at=now-2000,
 i=>i.oracle.at(-1).at=now-3000,i=>i.twap.at(-1).at=now+1]){
  const i=observation();mutate(i);assert(!evaluate(i).eligible);
 }
});
test('missing lookback samples, unconfirmed impulses, flat TWAP and model disagreement are rejected',()=>{
 for(const mutate of [i=>i.oracle.splice(80,10),i=>i.spot=i.spot.slice(-2),
 i=>i.twap=i.twap.map(p=>({...p,value:i.strike})),i=>i.twap.at(-1).value=f(76900)]){
 const i=observation();mutate(i);assert(!evaluate(i).eligible);
 }
});
test('bucket uses the retained tail, not a proportional chunk of the current average',()=>{
 const points=Array.from({length:61},(_,n)=>({at:now-60000+n*1000,value:f(n<30?80:100)}));
 const p=bucketProjection({now,end:now+30000,windowSeconds:60,reference:f(100),side:'Up',twap:{at:now,value:f(90)},oracle:points,spot:f(110),impulseFrom:f(100),retreatPct:0,clearBufferBp:0,maxModelErrorBp:0,latencyMs:0});
 assert(p.available);assert.equal(p.projected,f(100)); // Current oracle spot is the conservative 100.
 assert.equal(priceArea(points,now-30000,now),BigInt(f(100))*30000n);
});
test('integration rejects gaps and does not invent time weights',()=>{
 assert.equal(priceArea([{at:0,value:'10'},{at:1000,value:'20'},{at:2000,value:'30'}],500,1500),15000n);
 assert.equal(priceArea([{at:0,value:'10'},{at:4000,value:'20'}],0,4000),null);
});
test('entry economics rejects poor profit room, unavailable exit depth and large spreads',()=>{
 for(const book of [
 {bids:[{price:'0.969',size:'10000'}],asks:[{price:'0.97',size:'10000'}]},
 {bids:[],asks:[{price:'0.2',size:'10000'}]},
 {bids:[{price:'0.1',size:'10000'}],asks:[{price:'0.3',size:'10000'}]},
 {bids:[{price:'0.49',size:'10000'}],asks:[{price:'0.5',size:'1'}]},
 ]) assert(!entryPlan(DEFAULT_CONFIG,book,stake(DEFAULT_CONFIG),.07,1).ok);
});
test('allocation respects both dollar and bankroll caps without doubling after losses',()=>{
 assert.equal(stake(DEFAULT_CONFIG),10000000);
 assert.equal(stake({...DEFAULT_CONFIG,tradeBudgetCents:300}),3000000);
 assert.equal(stake({...DEFAULT_CONFIG,bankrollCents:20000}),2000000);
});
test('profit exits use a valid observed tick and never lower the calculated target floor',()=>{
 const bids=[{price:'0.66',size:'5'},{price:'0.64',size:'10'},{price:'0.62',size:'100'}];
 const plan=exitPlan(bids,12000000,0.631457,.07,1);
 assert(plan);assert.equal(plan.limit,.64);assert(plan.limit>=.631457);
 assert.equal(exitPlan(bids,16000000,0.631457,.07,1),null);
 const protective=exitPlan(bids,16000000,.001,.07,1);assert.equal(protective.limit,.62);
});
test('risk reserves open exposure and stops at concurrent and daily/weekly limits',()=>{
 const c=DEFAULT_CONFIG;
 assert(riskAllowed(c,10000000,0,10000000,0,0,0));
 assert(!riskAllowed(c,10000000,0,9999999,0,0,0));
 assert(!riskAllowed(c,10000000,0,100000000,0,0,2));
 assert(!riskAllowed(c,10000000,25000000,100000000,0,0,1));
 assert(!riskAllowed(c,10000000,0,100000000,-25000000,0,0));
 assert(!riskAllowed(c,10000000,0,100000000,0,-75000000,0));
});
test('ARM blocks entries; live additionally requires reviewed configuration, wallet and region',()=>{
 const command={action:'entry',positionId:randomUUID(),orderId:randomUUID(),market:m,observation:observation()};
 assert.throws(()=>reduce(initialState('paper'),command,now),/ARM/);
 assert.throws(()=>reduce(initialState('live'),{action:'arm',confirmVersion:1},now),/region/);
 assert.throws(()=>reduce(initialState('live'),{action:'arm',confirmVersion:0},now,true),/confirm/);
 const live=initialState('live');live.connection={status:'connected',at:now,balance:100000000,message:''};
 assert(reduce(live,{action:'arm',confirmVersion:1},now,true).state.armed);
});
test('paper fills debit once and duplicate receipts cannot alter the journal',()=>{
 const {s,id,fill}=entered();assert.equal(s.cash,s.initialCash-s.positions[0].cost);
 assert.throws(()=>reduce(s,{action:'fill',positionId:id,orderId:fill.orderId,fills:[fill]},now));
 assert.equal(s.positions[0].fills.length,1);assert.equal(s.positions[0].setup,'flip');
 assert(BigInt(s.positions[0].entryHeadroom)>0n);
});
test('net profit target closes only owned shares with recorded execution P/L',()=>{
 let {s,id}=entered();const i=observation();i.up.bids=[{price:'0.65',size:'10000'}];i.up.asks=[{price:'0.66',size:'10000'}];
 const sig=exitSignal(s.positions[0],i,s.config);assert.equal(sig.purpose,'profit-target');
 const orderId=randomUUID();s=reduce(s,{action:'exit',positionId:id,orderId,purpose:sig.purpose,limit:sig.min,shares:sig.shares,observation:i},now).state;
 s=reduce(s,{action:'submit',positionId:id,orderId},now).state;
 const q=sellQuote(i.up.bids,sig.shares,sig.min,m.feeRate,m.feeExponent);
 const fill={...q,id:`paper:${orderId}`,orderId,side:'SELL',tokenId:m.upToken,transactionHash:null,logIndex:0,blockNumber:0,tradeIds:[]};
 const result=reduce(s,{action:'fill',positionId:id,orderId,fills:[fill]},now);
 assert.equal(result.closed.pnl,result.closed.proceeds-result.closed.cost);assert.equal(result.state.wins,1);
 assert.equal(result.state.cash,result.state.initialCash+result.closed.pnl);assert.equal(result.state.positions.length,0);
 assert.equal(result.closed.sold,result.closed.shares);assert(result.closed.pnl>=result.closed.cost*.2);
});
test('weakening estimates and missing oracle data produce protective exits; disarming prevents submission',()=>{
 const {s,id}=entered(),i=observation();i.spot.at(-1).bid=f(77000.1);i.spot.at(-1).ask=f(77000.1);
 assert.equal(exitSignal(s.positions[0],i,s.config).purpose,'weakening');
 const gap=observation();gap.oracle=[];assert.equal(exitSignal(s.positions[0],gap,s.config).purpose,'feed-gap');
 const off=reduce(s,{action:'disarm'},now).state;
 assert.throws(()=>reduce(off,{action:'exit',positionId:id,orderId:randomUUID(),purpose:'weakening',limit:.49,shares:s.positions[0].shares,observation:i},now),/ARM/);
});
test('unresolved orders and inventory mismatches block further exposure and fabricated settlement',()=>{
 let {s,id}=entered();s.positions[0].inventoryError=true;assert(!canEnter(s,1000000,now));
 assert.throws(()=>reduce(s,{action:'resolve',positionId:id,winner:'Up'},m.end*1000+1),/settlement/i);
 ({s,id}=entered());assert.throws(()=>reduce(s,{action:'resolve',positionId:id,winner:'Up'},now));
 s.positions[0].order={id:randomUUID(),side:'SELL',purpose:'weakening',amount:s.positions[0].shares,limit:.49,status:'uncertain',createdAt:now};
 assert(!canEnter(s,1000000,now));assert.throws(()=>reduce(s,{action:'resolve',positionId:id,winner:'Up'},m.end*1000+1));
});
test('holds reset on crossings and reject disconnected samples',()=>{
 const p=[0,1000,2000,3000,4000].map(at=>({at,value:'1'}));assert(held(p,4000,3000,()=>true,1500));
 p[2].value='0';assert(!held(p,4000,3000,x=>x.value==='1',1500));
 p.splice(2,1);assert(!held(p,4000,3000,()=>true,1500));
});
test('feed continuity resets after gaps; opening reference requires the exact boundary',()=>{
 const feeds=new Feeds(),start=Math.floor(Date.now()/300000)*300000;
 feeds.addTwap({symbol:'btc/usd',windowSeconds:60,timestamp:start+1,value:'77000'});assert(!feeds.opening.has(`BTC:300:${start/1000}`));
 feeds.twap.clear();feeds.addTwap({symbol:'btc/usd',windowSeconds:60,timestamp:start,value:'77000'});assert.equal(feeds.opening.get(`BTC:300:${start/1000}`),f(77000));
 feeds.observe('test',10000,2500);feeds.observe('test',11000,2500);assert.equal(feeds.continuity.get('test').since,10000);
 feeds.observe('test',15000,2500);assert.equal(feeds.continuity.get('test').since,15000);
});
test('Gamma identity, lookback and official settlement validation are mandatory',()=>{
 const raw={slug:m.slug,eventStartTime:new Date(m.start*1000).toISOString(),endDate:new Date(m.end*1000).toISOString(),
 cryptoMarketConfig:{asset:'btc',duration:'5m',twapEnabled:true,twapLookbackSeconds:60},resolutionSource:'https://data.chain.link/streams/btc-usd-twap-60s-streams',
 outcomes:'["Up","Down"]',clobTokenIds:'["123","456"]',outcomePrices:'["1","0"]',conditionId:m.conditionId,feesEnabled:true,feeSchedule:{rate:.07,exponent:1},closed:true,umaResolutionStatus:'resolved'};
 assert.equal(parseMarket(raw,'BTC',300,m.start).winner,'Up');assert.equal(parseMarket(raw,'BTC',300,m.start).windowSeconds,60);
 assert.throws(()=>parseMarket({...raw,resolutionSource:'other'},'BTC',300,m.start));
 assert.throws(()=>parseMarket({...raw,cryptoMarketConfig:{...raw.cryptoMarketConfig,twapLookbackSeconds:30}},'BTC',300,m.start));
 assert.equal(parseMarket({...raw,closed:false},'BTC',300,m.start).winner,null);
});
