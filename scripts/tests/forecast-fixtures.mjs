// Synthetic software fixtures, never production market data.
import {CANDLE_SECONDS} from '../../lib/bots/crypto-shares/forecast/identity.ts';
import {toE18} from '../../lib/bots/crypto-shares/forecast/candles.ts';
import {marketSlug} from '../../lib/bots/crypto-shares/forecast/market.ts';
export const e18=n=>toE18(String(n));
export function forecastFixture(horizon=300,target=1789135200,side='Up') {
 const now=target*1000-24000;
 const candles=CANDLE_SECONDS.flatMap(seconds=>{
  const end=Math.floor(now/(seconds*1000))*seconds*1000;
  return Array.from({length:64},(_,i)=>{
   const start=end-(64-i)*seconds*1000,o=100+i*0.5,c=o+0.4,h=c+0.1,l=o-0.1;
   const prices=i===62?[131.4,131.5,130.7,130.8]:i===63?[130.8,132,130.7,131.9]:[o,h,l,c];
   const [open,high,low,close]=prices.map(e18);
   return {start,end:start+seconds*1000,seconds,open,high,low,close,firstAt:start,lastAt:start+seconds*1000-1,complete:true};
  });
 });
 if(side==='Down')for(const c of candles){const old={...c};c.open=(BigInt(e18(300))-BigInt(old.open)).toString();c.close=(BigInt(e18(300))-BigInt(old.close)).toString();c.high=(BigInt(e18(300))-BigInt(old.low)).toString();c.low=(BigInt(e18(300))-BigInt(old.high)).toString();}
 const market={slug:marketSlug(target,horizon),start:target,end:target+horizon,horizon,conditionId:'0x'+'1'.repeat(64),upToken:'111',downToken:'222',source:horizon===3600?'binance-hourly':'chainlink-twap-60',feeRate:0.07,feeExponent:1,accepting:true,winner:null};
 return {now,target,candles,latest:{at:now,value:e18(side==='Up'?131.9:168.1)},market,book:{at:now,tokenId:side==='Up'?'111':'222',minShares:5,asks:[{price:'0.50',size:'1000'}],bids:[{price:'0.49',size:'1000'}]}};
}
export function gammaFixture(m) {
 return {slug:m.slug,eventStartTime:new Date(m.start*1000).toISOString(),endDate:new Date(m.end*1000).toISOString(),negRisk:false,conditionId:m.conditionId,resolutionSource:m.horizon===3600?'https://www.binance.com/en/trade/BTC_USDT':'https://data.chain.link/streams/btc-usd-twap-60s-streams',description:'BTC/USDT 1 hour candle close price greater than or equal to the open price',cryptoMarketConfig:{asset:'btc',duration:`${m.horizon/60}m`,twapEnabled:true,twapLookbackSeconds:60},outcomes:'["Down","Up"]',clobTokenIds:JSON.stringify([m.downToken,m.upToken]),outcomePrices:'["0.5","0.5"]',closed:false,umaResolutionStatus:'proposed',feesEnabled:true,feeSchedule:{rate:0.07,exponent:1},acceptingOrders:true};
}
