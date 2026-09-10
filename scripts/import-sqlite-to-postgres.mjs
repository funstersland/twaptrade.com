import {DatabaseSync} from 'node:sqlite';
import pg from 'pg';
import fs from 'node:fs';
const sqlitePath = process.argv[2];
if (!sqlitePath || !fs.existsSync(sqlitePath) || !process.env.DATABASE_URL) throw Error('Pass the source SQLite file and set DATABASE_URL.');
const source = new DatabaseSync(sqlitePath,{readOnly:true});
const target = new pg.Client({connectionString:process.env.DATABASE_URL,connectionTimeoutMillis:15000});
await target.connect();
try {
  source.exec('BEGIN');
  await target.query('BEGIN');
  await target.query('SELECT pg_advisory_xact_lock(847291104)');
  await target.query('SET CONSTRAINTS ALL DEFERRED');
  const tables=source.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%' AND name NOT IN ('d1_migrations','sessions','auth_limits','continuation_feed')").all().map(r=>r.name);
  const quote=(v)=>{if(!/^[a-z][a-z0-9_]*$/.test(v))throw Error('Invalid SQL identifier');return '"'+v+'"';};
  for (const table of tables) {
    const existing=await target.query(`SELECT count(*) total FROM ${quote(table)}`);
    if(Number(existing.rows[0].total)!==0)throw Error(`Target table ${table} is not empty; import stopped without overwriting data.`);
  }
  for (const table of tables) {
    const rows=source.prepare(`SELECT * FROM ${quote(table)}`).all();
    for(const row of rows){
      const columns=Object.keys(row),values=Object.values(row);
      await target.query(`INSERT INTO ${quote(table)} (${columns.map(quote).join(',')}) VALUES (${values.map((_,i)=>'$'+(i+1)).join(',')})`,values);
    }
    const count=Number((await target.query(`SELECT count(*) total FROM ${quote(table)}`)).rows[0].total);
    if(count!==rows.length)throw Error(`Import verification failed for ${table}`);
    console.log(`${table}: ${count} records verified`);
  }
  await target.query('COMMIT');source.exec('COMMIT');
  console.log('Import complete. Existing local data was not modified. Sessions and transient engine leases are not copied.');
}catch(error){await target.query('ROLLBACK');console.error('Import stopped:',error.message);process.exitCode=1;}
finally{source.close();await target.end();}
