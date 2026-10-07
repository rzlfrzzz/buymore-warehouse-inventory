import pg from 'pg';
import type { Transaction } from './stock-count.js';
export function database(connectionString: string) {
 const pool=new pg.Pool({connectionString});
 const transaction: Transaction=async work=>{
  const client=await pool.connect();
  try { await client.query('BEGIN'); const result=await work(client); await client.query('COMMIT'); return result; }
  catch(error) { await client.query('ROLLBACK'); throw error; }
  finally { client.release(); }
 };
 return {pool,transaction};
}
