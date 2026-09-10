import {passwordHash} from "../../lib/server/password.ts";
import fs from'node:fs';import assert from'node:assert/strict';import pg from'pg';import{randomUUID}from'node:crypto';
const cfg=JSON.parse(fs.readFileSync('.sites-runtime/postgres-test-env.json'));if(cfg.TWAP_DB_SCHEMA!=='verification')throw Error('Verification schema required');
const db=new pg.Client({connectionString:cfg.DATABASE_URL,options:'-c search_path=verification,public'});await db.connect();let checks=0;
const origin='http://localhost:3001';async function api(path,data,cookie,expected=200){const r=await fetch(origin+path,{method:data?'POST':'GET',headers:{origin,'content-type':'application/json',...(cookie?{cookie}:{})},...(data?{body:JSON.stringify(data)}:{})});const d=await r.json();assert.equal(r.status,expected,JSON.stringify(d));checks++;return{d,cookie:r.headers.get('set-cookie')?.split(';')[0]};}
const owner=await api('/api/auth',{action:'login',email:cfg.TWAP_ADMIN_EMAIL,password:'IsolatedOwner#2026!'});
const users=[0,1].map(()=>({user_id:randomUUID(),email:randomUUID()+'@example.test'}));
for(const u of users){const now=new Date().toISOString();await db.query("INSERT INTO profiles(user_id,display_name,email,role,status,referral_code,created_at,last_login_at,preferences,auth_method) VALUES($1,'Ledger test',$2,'user','active',$3,$4,$4,'{}','password')",[u.user_id,u.email,'TW-'+randomUUID(),now]);await db.query('INSERT INTO credentials(user_id,password_hash,updated_at) VALUES($1,$2,$3)',[u.user_id,passwordHash('TestMember#2026!'),now]);}
const member=await api('/api/auth',{action:'login',email:users[0].email,password:'TestMember#2026!'});
const p=await api('/api/profit-loss',{action:'prepare',direction:'profit',amountCents:500000,mode:'selected',userIds:users.map(u=>u.user_id)},owner.cookie,201);
await api('/api/profit-loss',{action:'apply',batchId:p.d.batchId},owner.cookie);await api('/api/profit-loss',{action:'apply',batchId:p.d.batchId},owner.cookie);
const entries=(await db.query('SELECT count(*) count FROM transactions WHERE id LIKE $1',[p.d.batchId+':%'])).rows[0];assert.equal(Number(entries.count),2);checks++;
const l1=await api('/api/profit-loss',{action:'prepare',direction:'loss',amountCents:400000,mode:'single',userIds:[users[0].user_id]},owner.cookie,201);
const l2=await api('/api/profit-loss',{action:'prepare',direction:'loss',amountCents:400000,mode:'single',userIds:[users[0].user_id]},owner.cookie,201);
const results=await Promise.all([l1,l2].map(async l=>{const r=await fetch(origin+'/api/profit-loss',{method:'POST',headers:{origin,'content-type':'application/json',cookie:owner.cookie},body:JSON.stringify({action:'apply',batchId:l.d.batchId})});return r.status;}));
assert.deepEqual(results.sort(),[200,409]);checks++;
const bot=randomUUID();await api('/api/admin',{action:'save-bot',name:'Ledger verification '+bot,pair:'TEST',family:'Crypto Futures',description:'Isolated verification fixture',status:'published',minAllocationCents:100000},owner.cookie);
const id=(await db.query('SELECT id FROM bots WHERE name=$1',['Ledger verification '+bot])).rows[0].id;
await api('/api/bots',{action:'deploy',botId:id,allocationCents:200000},member.cookie,409);
await api('/api/bots',{action:'deploy',botId:id,allocationCents:100000},member.cookie,201);
await api('/api/profit-loss',{action:'prepare',direction:'loss',amountCents:1,mode:'single',userIds:[users[0].user_id]},owner.cookie,409);
const acct=await api('/api/account',{action:'init'},member.cookie);assert(acct.d.transactions.length>=2);checks++;
console.log(`PostgreSQL ledger integration: ${checks} checks passed, including concurrent loss protection and deployment reservations.`);await db.end();
