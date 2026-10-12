// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import { StockOutWorkspace, displayStockOutTime, localInputTime } from "./StockOutWorkspace";
import { ConnectedLayout } from "../layouts/ConnectedLayout";

it("renders catalog form and timezone history, posts taker separately and refreshes", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const host=document.createElement("div"); document.body.append(host);
  const root=createRoot(host), refresh=vi.fn().mockResolvedValue(undefined);
  const record={id:"id",product:"SKU",product_name:"Catalog name",quantity:1,unit:"PCS",base_quantity:1,purpose:"PRODUCTION",warehouse:"WH",location:"A",batch:"",taker:"Warehouse taker",taken_at:"2026-10-12T02:00:00Z",recorded_at:"2026-10-12T03:00:00Z",recorder:"admin"};
  const fetcher=vi.fn(async (url:string, options:any) => ({ok:true,json:async () => options?.method==="POST" ? record : url.endsWith("catalog") ? {products:[{code:"SKU",name:"Catalog name",uom:"BOX",uom_factor:5}],locations:[{id:"A"}],batches:[{product:"SKU",batch:""}],balances:[]} : {records:[record],destinations:[]}}));
  vi.stubGlobal("fetch",fetcher);
  try {
    await act(async () => root.render(<StockOutWorkspace warehouse="WH" refresh={refresh} setBusy={() => {}}/>));
    expect(host.textContent).toContain("Warehouse taker");
    expect(host.textContent).toContain(displayStockOutTime(record.taken_at));
    expect(localInputTime()).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/);
    async function change(label:string,value:string) {
      const element=[...host.querySelectorAll("label")].find(l => l.textContent?.startsWith(label))!.querySelector("input,select")!;
      await act(async () => {
        Object.getOwnPropertyDescriptor(element.tagName==="SELECT" ? HTMLSelectElement.prototype : HTMLInputElement.prototype,"value")!.set!.call(element,value);
        element.dispatchEvent(new Event(element.tagName==="SELECT" ? "change" : "input",{bubbles:true}));
      });
    }
    await change("Cari material", "no match");
    expect(host.querySelectorAll("select")[0].options.length).toBe(1);
    await change("Cari material", "Catalog name");
    expect(host.querySelectorAll("select")[0].options.length).toBe(2);
    await change("Cari riwayat", "no match");
    expect(host.querySelectorAll("tbody tr").length).toBe(0);
    await change("Cari riwayat", "Warehouse taker");
    expect(host.querySelectorAll("tbody tr").length).toBe(1);
    await change("SKU","SKU"); await change("Lokasi sumber","A"); await change("Jumlah diambil","2"); await change("Nama pengambil","Actual person");
    expect(host.querySelector<HTMLInputElement>("input[readonly]")!.value).toBe("Catalog name");
    await act(async () => {host.querySelector("form")!.dispatchEvent(new Event("submit",{bubbles:true,cancelable:true}));});
    const post=fetcher.mock.calls.find(([,o]) => o.method==="POST")!;
    expect(JSON.parse(post[1].body)).toMatchObject({quantity:2,taker:"Actual person",product:"SKU",purpose:"PRODUCTION"});
    expect(post[1].headers["Idempotency-Key"]).toBeTruthy();
    expect(refresh).toHaveBeenCalledOnce();
  } finally {await act(async () => root.unmount()); host.remove(); vi.unstubAllGlobals();}
});

it("exposes Ringkasan and Stock Out to User and Admin in the active layout", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT",true);
  const host=document.createElement("div"), root=createRoot(host), navigate=vi.fn();
  try {
    for(const role of ["Admin","User"] as const) {
      await act(async () => root.render(<ConnectedLayout inspectionMode session={{user:{id:"u",username:"operator"},memberships:[{warehouse:"WH",role}]}} warehouse="WH" setWarehouse={() => {}} page="counts" navigate={navigate} logout={() => {}} busy={false}><p>Workspace</p></ConnectedLayout>));
      const button=[...host.querySelectorAll("nav button")].find(b => b.textContent==="Stock Out");
      expect(Boolean(button)).toBe(true);
      const summary=[...host.querySelectorAll("nav button")].find(b => b.textContent==="Ringkasan") as HTMLButtonElement;
      await act(async () => summary.click()); expect(navigate).toHaveBeenCalledWith("dashboard");
      if(button) {await act(async () => (button as HTMLButtonElement).click()); expect(navigate).toHaveBeenCalledWith("issue");}
    }
  } finally {await act(async () => root.unmount()); vi.unstubAllGlobals();}
});