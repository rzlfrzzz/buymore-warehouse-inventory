import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { PGlite } from "@electric-sql/pglite";
import { createApi } from "../src/api.js";
import { hashPassword } from "../src/auth.js";
import { migrate, type Runtime } from "../src/runtime.js";
import type { DB } from "../src/stock-count.js";

test("Stock Out HTTP atomic posting, permissions, retries and stock guards", async () => {
  const engine = new PGlite();
  const db: Runtime = {transaction: work => engine.transaction(tx => work(tx as DB)), close: () => engine.close()};
  await migrate(db);
  const admin = randomUUID(), user = randomUUID();
  const password = "stock-out-test-password";
  for(const [id,name,role] of [[admin,"admin","Admin"],[user,"user","User"]]) {
    await engine.query("INSERT INTO users VALUES($1,$2,$3,true)",[id,name,await hashPassword(password)]);
    await engine.query("INSERT INTO memberships VALUES($1,'WH',$2)",[id,role]);
  }
  await engine.exec("INSERT INTO locations VALUES('WH','A'),('DEST','B'),('DENIED','C'); INSERT INTO products(code,name,uom,uom_factor) VALUES('SKU','Test item','BOX',5); INSERT INTO product_batches(product,batch) VALUES('SKU','');");
  await engine.query("INSERT INTO memberships VALUES($1,'DEST','Admin')",[admin]);
  await engine.query("INSERT INTO inventory_ledger(id,warehouse,location,product,batch,delta,actor) VALUES($1,'WH','A','SKU','',30,$2)",[randomUUID(),admin]);
  const origin="http://localhost:5173";
  const server=await createApi(db,{origin,secureCookies:false});
  await new Promise<void>(resolve => server.listen(0,"127.0.0.1",resolve));
  const base=`http://127.0.0.1:${(server.address() as {port:number}).port}/api`;
  async function login(username:string) {
    const response=await fetch(base+"/login",{method:"POST",headers:{Origin:origin,"Content-Type":"application/json"},body:JSON.stringify({username,password})});
    assert.equal(response.status,200); return response.headers.get("set-cookie")!.split(";")[0];
  }
  try {
    const cookie=await login("admin"), userCookie=await login("user");
    const input={product:"SKU",location:"A",batch:"",unit:"BOX",quantity:2,purpose:"PRODUCTION",taker:"Actual taker",takenAt:"2026-10-12T09:00:00+07:00"};
    const post=(body:object,key=randomUUID(),auth=cookie) => fetch(base+"/workspace/stock-outs",{method:"POST",headers:{Origin:origin,Cookie:auth,"X-Warehouse":"WH","Content-Type":"application/json","Idempotency-Key":key},body:JSON.stringify(body)});
    const get=(auth=cookie) => fetch(base+"/workspace/stock-outs",{headers:{Cookie:auth,"X-Warehouse":"WH"}});
    assert.equal((await get(userCookie)).status,200);
    assert.deepEqual((await (await get(userCookie)).json()).destinations, []);
    const key=randomUUID();
    const created=await post(input,key,userCookie); assert.equal(created.status,201,JSON.stringify(await created.clone().json()));
    const record=await created.json();
    assert.equal(record.recorded_by,user);
    assert.equal((await (await post(input,key,userCookie)).json()).id,record.id);
    assert.equal((await post({...input,quantity:1},key,userCookie)).status,409);
    for(const bad of [{quantity:0},{quantity:1.5},{quantity:"1"},{quantity:2147483647},{unit:"INVALID"},{batch:"unknown"},{purpose:"OTHER"},{taker:" "},{takenAt:"2026-10-12T09:00"},{destinationWarehouse:"DEST"}]) assert.equal((await post({...input,...bad})).status,400);
    assert.equal((await post({...input,quantity:5})).status,409);
    const transfer={...input,quantity:1,purpose:"TRANSFER",destinationWarehouse:"DEST",destinationLocation:"B"};
    assert.equal((await post({...transfer,destinationWarehouse:"DENIED",destinationLocation:"C"})).status,403);
    assert.equal((await post({...transfer,destinationLocation:"missing"})).status,400);
    assert.equal((await post(transfer,randomUUID(),userCookie)).status,403);
    await engine.query("INSERT INTO memberships VALUES($1,'DEST','User')",[user]);
    assert.deepEqual((await (await get(userCookie)).json()).destinations,[{warehouse:"DEST",location:"B"}]);
    const transferKey=randomUUID();
    assert.equal((await post(transfer,transferKey,userCookie)).status,201);
    await engine.query("DELETE FROM memberships WHERE user_id=$1 AND warehouse='DEST'",[user]);
    assert.equal((await post(transfer,transferKey,userCookie)).status,403);
    assert.equal((await (await get(userCookie)).json()).records.find((r:any) => r.purpose==='TRANSFER').destination_warehouse,null);
    const summary=(warehouse="WH",query="from=2026-10-12&to=2026-10-12") => fetch(base+"/workspace/stock-out-summary?"+query,{headers:{Cookie:userCookie,"X-Warehouse":warehouse}});
    assert.equal((await summary("DENIED")).status,403);
    assert.equal((await summary("WH","from=invalid&to=2026-10-12")).status,400);
    const report=await (await summary()).json();
    assert.deepEqual(report.totals,{count:2,pcs:15,production_count:1,production_pcs:10,transfer_count:1,transfer_pcs:5});
    assert.equal(report.items[0].pcs,15);
    assert.equal((await (await summary("WH","from=2026-10-13&to=2026-10-13")).json()).totals.count,0);
    assert.equal((await (await summary("WH","from=2026-10-12&to=2026-10-12&search=TRANSFER")).json()).totals.pcs,5);
    assert.equal((await fetch(base+"/workspace/stock-outs",{headers:{Cookie:userCookie,"X-Warehouse":"DENIED"}})).status,403);
    const totals=await engine.query<{warehouse:string; quantity:number}>("SELECT warehouse,sum(delta)::int AS quantity FROM inventory_ledger GROUP BY warehouse ORDER BY warehouse");
    assert.deepEqual(totals.rows,[{warehouse:"DEST",quantity:5},{warehouse:"WH",quantity:15}]);
    const doc=randomUUID();
    await engine.query("INSERT INTO operation_documents(id,warehouse,type,status,created_by) VALUES($1,'WH','ISSUE','PENDING',$2)",[doc,admin]);
    await engine.query("INSERT INTO inventory_reservations(id,warehouse,location,product,batch,quantity,document_id,status) VALUES($1,'WH','A','SKU','',15,$2,'ACTIVE')",[randomUUID(),doc]);
    assert.equal((await post(input)).status,409);
    assert.equal((await post(input,randomUUID(),userCookie)).status,409);
    await engine.query("UPDATE inventory_reservations SET status='RELEASED'");
    await engine.query("INSERT INTO stock_counts(id,warehouse,location,status,counted_by) VALUES($1,'DEST','B','COUNTING',$2)",[randomUUID(),admin]);
    assert.equal((await post(transfer)).status,409);
    assert.equal((await (await get()).json()).records.length,2);
    await assert.rejects(engine.query("UPDATE stock_outs SET taker='changed' WHERE id=$1",[record.id]),/Append-only/);
    await engine.query("UPDATE products SET active=false WHERE code='SKU'");
    assert.equal((await post(input)).status,400);
    assert.equal((await engine.query("SELECT * FROM stock_out_movements")).rows.length,3);
    assert.equal((await engine.query("SELECT * FROM audit_events WHERE action='stock-out.post'")).rows.length,2);
    // Exercise the real posting path beyond the history cap, without a live DB.
    await engine.query("UPDATE products SET active=true WHERE code='SKU'");
    await engine.query("INSERT INTO inventory_ledger(id,warehouse,location,product,batch,delta,actor) VALUES($1,'WH','A','SKU','',300,$2)",[randomUUID(),admin]);
    for (let i=0; i<201; i++) {
      assert.equal((await post({...input,unit:"PCS",quantity:1},randomUUID(),userCookie)).status,201);
    }
    assert.equal((await (await get(userCookie)).json()).records.length,200);
    const complete = await (await summary()).json();
    assert.deepEqual(complete.totals,{count:203,pcs:216,production_count:202,production_pcs:211,transfer_count:1,transfer_pcs:5});
    assert.equal(complete.items[0].pcs,216);
    // Destination receipts cannot confer source membership on retries either.
    await engine.query("DELETE FROM memberships WHERE user_id=$1 AND warehouse='WH'",[user]);
    assert.equal((await post(input,key,userCookie)).status,403);
  } finally { await new Promise<void>(resolve => server.close(() => resolve())); await db.close(); }
});