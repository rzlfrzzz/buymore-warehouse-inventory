import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { randomBytes } from 'node:crypto';
import { hashPassword, tokenHash, verifyPassword } from './auth.js';
import { StockCountService, reasons, type Actor, type CountLine } from './stock-count.js';
import type { Runtime } from './runtime.js';
class HttpError extends Error { constructor(public status: number, message: string) { super(message); } }
function requireValue(value: unknown, status: number, message: string): asserts value { if (!value) throw new HttpError(status,message); }
function text(value: unknown, label: string, max=200): string { requireValue(typeof value==='string' && value.trim().length>0 && value.length<=max,400,`Invalid ${label}`); return value; }
const uuid = (value: string) => { requireValue(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value),400,'Invalid document ID'); return value; };
function fields(body: Record<string,unknown>, allowed: string[]) { requireValue(Object.keys(body).every(k=>allowed.includes(k)),400,'Unknown request field'); }
async function body(req: IncomingMessage): Promise<Record<string,unknown>> {
 requireValue(req.headers['content-type']?.split(';')[0]==='application/json',415,'JSON required');
 const chunks: Buffer[]=[]; let size=0;
 for await (const chunk of req) { size+=chunk.length; requireValue(size<=65536,413,'Request too large'); chunks.push(chunk); }
 try { const parsed=JSON.parse(Buffer.concat(chunks).toString('utf8')); requireValue(parsed && typeof parsed==='object' && !Array.isArray(parsed),400,'Object required'); return parsed; }
 catch { throw new HttpError(400,'Invalid JSON object'); }
}
function lines(value: unknown): CountLine[] {
 requireValue(Array.isArray(value) && value.length>0 && value.length<=500,400,'1-500 count lines required');
 return value.map(l=>{
  requireValue(l && typeof l==='object' && !Array.isArray(l),400,'Invalid line'); fields(l,['product','batch','quantity','reason','explanation']);
  const product=text(l.product,'product',100); requireValue(typeof l.batch==='string' && l.batch.length<=100,400,'Invalid batch');
  requireValue(Number.isInteger(l.quantity) && l.quantity>=0 && l.quantity<=2147483647,400,'Invalid quantity');
  if(l.reason!==undefined) requireValue(reasons.includes(l.reason),400,'Invalid reason');
  if(l.explanation!==undefined) text(l.explanation,'explanation',2000);
  return {product,batch:l.batch,quantity:l.quantity,reason:l.reason,explanation:l.explanation};
 });
}
export async function createApi(db: Runtime, options: { origin: string; secureCookies: boolean }) {
 const service=new StockCountService(db.transaction);
 const dummyHash=await hashPassword(randomBytes(32).toString('hex'));
 const cookieName=options.secureCookies?'__Host-buymore':'buymore_session';
 const cookie=(value: string, age: number)=>`${cookieName}=${value}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${age}${options.secureCookies?'; Secure':''}`;
 function send(res: ServerResponse,status: number,result: unknown) { res.writeHead(status,{'Content-Type':'application/json; charset=utf-8'}); res.end(JSON.stringify(result)); }
 return createServer(async(req,res)=>{
  res.setHeader('Cache-Control','no-store'); res.setHeader('X-Content-Type-Options','nosniff'); res.setHeader('Referrer-Policy','no-referrer');
  try {
   const url=new URL(req.url || '/', 'http://localhost'); const path=url.pathname; const method=req.method;
   if(method==='GET' && path==='/api/health') { await db.transaction(tx=>tx.query('SELECT 1')); return send(res,200,{ok:true}); }
   if(method!=='GET') requireValue(req.headers.origin===options.origin && req.headers['sec-fetch-site']!=='cross-site',403,'Untrusted request origin');
   if(method==='POST' && path==='/api/login') {
    const input=await body(req); fields(input,['username','password']); const username=text(input.username,'username',100).toLowerCase(); const password=text(input.password,'password',256);
    const keys=[tokenHash(`ip:${req.socket.remoteAddress}`),tokenHash(`user:${username}`)].sort();
    await db.transaction(async tx=>{
     for(const key of keys) {
      await tx.query('SELECT pg_advisory_xact_lock(hashtext($1))',[key]);
      const r=(await tx.query('SELECT attempts,reset_at>now() AS active FROM login_attempts WHERE key=$1',[key])).rows[0];
      requireValue(!r || !r.active || r.attempts<10,429,'Too many login attempts; retry after 15 minutes');
     }
     for(const key of keys) await tx.query("INSERT INTO login_attempts VALUES ($1,1,now()+interval '15 minutes') ON CONFLICT(key) DO UPDATE SET attempts=CASE WHEN login_attempts.reset_at<=now() THEN 1 ELSE login_attempts.attempts+1 END,reset_at=CASE WHEN login_attempts.reset_at<=now() THEN now()+interval '15 minutes' ELSE login_attempts.reset_at END",[key]);
    });
    const user=await db.transaction(async tx=>(await tx.query('SELECT id,username,password_hash,enabled FROM users WHERE username=$1',[username])).rows[0]);
    const valid=await verifyPassword(password,user?.password_hash || dummyHash);
    requireValue(valid && user?.enabled,401,'Invalid username or password');
    const token=randomBytes(32).toString('hex');
    await db.transaction(async tx=>{
     await tx.query('DELETE FROM sessions WHERE expires_at<=now()');
     await tx.query("INSERT INTO sessions VALUES ($1,$2,now()+interval '8 hours')",[tokenHash(token),user.id]);
    });
    res.setHeader('Set-Cookie',cookie(token,28800)); return send(res,200,{ok:true});
   }
   const token=(req.headers.cookie || '').split(';').map(v=>v.trim()).find(v=>v.startsWith(`${cookieName}=`))?.slice(cookieName.length+1) || '';
   requireValue(/^[a-f0-9]{64}$/.test(token),401,'Authentication required');
   const user=await db.transaction(async tx=>(await tx.query('SELECT u.id,u.username FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.token_hash=$1 AND s.expires_at>now() AND u.enabled=true',[tokenHash(token)])).rows[0]);
   requireValue(user,401,'Session expired');
   if(method==='POST' && path==='/api/logout') { await db.transaction(tx=>tx.query('DELETE FROM sessions WHERE token_hash=$1',[tokenHash(token)])); res.setHeader('Set-Cookie',cookie('',0)); return send(res,200,{ok:true}); }
   const memberships=await db.transaction(async tx=>(await tx.query('SELECT warehouse,role FROM memberships WHERE user_id=$1 ORDER BY warehouse',[user.id])).rows);
   if(method==='GET' && path==='/api/session') return send(res,200,{user,memberships});
   const warehouse=text(req.headers['x-warehouse'],'warehouse',100);
   const member=memberships.find(m=>m.warehouse===warehouse); requireValue(member,403,'Warehouse access denied');
   const actor: Actor={id:user.id,role:member.role,warehouse};
   if(method==='GET' && path==='/api/master') return send(res,200,await db.transaction(async tx=>({locations:(await tx.query('SELECT id FROM locations WHERE warehouse=$1 ORDER BY id',[warehouse])).rows,products:(await tx.query('SELECT DISTINCT product FROM inventory_ledger WHERE warehouse=$1 ORDER BY product',[warehouse])).rows})));
   if(method==='GET' && path==='/api/inventory') { requireValue(actor.role!=='Staff',403,'Inventory access denied'); return send(res,200,await db.transaction(async tx=>(await tx.query('SELECT location,product,batch,sum(delta)::int AS quantity FROM inventory_ledger WHERE warehouse=$1 GROUP BY location,product,batch ORDER BY location,product,batch',[warehouse])).rows)); }
   if(method==='GET' && path==='/api/counts') return send(res,200,await db.transaction(async tx=>(await tx.query(`SELECT id,location,status,counted_by,started_at,correction_of FROM stock_counts WHERE warehouse=$1${actor.role==='Staff'?' AND counted_by=$2':''} ORDER BY started_at DESC LIMIT 200`,actor.role==='Staff'?[warehouse,actor.id]:[warehouse])).rows));
   const countRoute=path.match(/^\/api\/counts\/([^/]+)(?:\/(submit|recount|verify|approve|cancel))?$/);
   if(method==='GET' && countRoute && !countRoute[2]) {
    const id=uuid(countRoute[1]);
    await authorizeCount(id,actor);
    const result=await service.read(actor,id);
    if(actor.role!=='Staff') Object.assign(result,{adjustment:await db.transaction(async tx=>(await tx.query('SELECT id,status FROM adjustments WHERE count_id=$1',[id])).rows[0] || null)});
    return send(res,200,result);
   }
   const postRoute=path.match(/^\/api\/adjustments\/([^/]+)\/post$/);
   requireValue(method==='POST' && (path==='/api/counts' || (countRoute && countRoute[2]) || postRoute),404,'Route not found');
   const input=await body(req); const rawKey=text(req.headers['idempotency-key'],'idempotency key',128);
   const key=`${actor.id}:${warehouse}:${rawKey}`;
   let result: unknown;
   if(path==='/api/counts') { requireValue(actor.role==='Staff',403,'Staff required'); fields(input,['location','correctionOf']); result=await service.start(actor,key,text(input.location,'location',100),input.correctionOf===undefined?undefined:uuid(text(input.correctionOf,'correctionOf'))); }
   else if(postRoute) {
    requireValue(actor.role==='Head',403,'Head required'); fields(input,[]); const id=uuid(postRoute[1]);
    const found=await db.transaction(async tx=>(await tx.query('SELECT a.id FROM adjustments a JOIN stock_counts c ON c.id=a.count_id WHERE a.id=$1 AND c.warehouse=$2',[id,warehouse])).rows.length);
    requireValue(found,404,'Adjustment not found'); result=await service.post(actor,key,id);
   } else {
    const id=uuid(countRoute![1]); const action=countRoute![2]; await authorizeCount(id,actor);
    requireValue(action==='cancel' || (action==='submit' && actor.role==='Staff') || (['verify','recount'].includes(action) && actor.role==='Admin') || (action==='approve' && actor.role==='Head'),403,'Permission denied');
    if(action==='submit' || action==='verify') { fields(input,['lines']); result=await service[action](actor,key,id,lines(input.lines)); }
    else if(action==='recount' || action==='cancel') { fields(input,['reason']); result=await service[action](actor,key,id,text(input.reason,'reason',2000)); }
    else { fields(input,[]); result=await service.approve(actor,key,id); }
   }
   send(res,200,result);
  } catch(error) {
   if(error instanceof HttpError) return send(res,error.status,{error:error.message});
   const message=error instanceof Error?error.message:'';
   const code=(error as {code?:string})?.code;
   if(code==='23505') return send(res,409,{error:'Conflicting document or active location count'});
   if(code==='23503' || code==='23514') return send(res,400,{error:'Invalid referenced data'});
   // Domain errors contain no SQL or credentials; unexpected database errors stay server-side.
   if(!code && /required|Invalid|not |immutable|forbidden|Idempotency|Unknown|Recount|Exact|Distinct|snapshot|Variance|Only /i.test(message)) return send(res,409,{error:message});
   console.error('API request failed',error instanceof Error?error.name:'UnknownError'); send(res,500,{error:'Internal server error'});
  }
 });
 async function authorizeCount(id: string,actor: Actor) {
  const found=await db.transaction(async tx=>(await tx.query(`SELECT id FROM stock_counts WHERE id=$1 AND warehouse=$2${actor.role==='Staff'?' AND counted_by=$3':''}`,actor.role==='Staff'?[id,actor.warehouse,actor.id]:[id,actor.warehouse])).rows.length);
  requireValue(found,404,'Count not found');
 }
}
