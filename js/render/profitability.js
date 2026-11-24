import { D, CM, FA, FP, FG, OFM } from "../state.js";
import { sheets, getBuyrate, artGroup } from "../api/sheets.js";
import { ADS } from "../api/ads.js";
import { cardByNm, cardsNmList } from "../api/wb.js";
import { wbPrice } from "../utils.js";

/* Экономика WB FBW: формулы перенесены из калькулятора маржи. */
const C = {
  log_fbw_base1:46, log_fbw_addl:14, log_fbw_coef:1.70,
  log_t20:23, log_t40:26, log_t60:29, log_t80:30, log_t100:32,
  prep_box:5, prep_move_l:7, ff_on:1, ff_flat:50,
  store_per_l:0.08, store_days:0, acquiring:3, wallet:3,
  comm_def_fbw:40, fixed:60, tax:6, vat:5
};
const COMM = [
  {pred:"Термоноски",fbw:39.5},{pred:"Термокомплекты",fbw:34.5},
  {pred:"Трусы",fbw:39.5},{pred:"Термомайки",fbw:43.5},{pred:"Леггинсы",fbw:43.5}
];
const LSKEY = "monitor_profit_overrides_v1";
const IP_DATA = {
  1: {
    arts:"https://docs.google.com/spreadsheets/d/e/2PACX-1vRv2VuvAbmweu5Q_5cj-zoss2s3RoFMwKfK2z6tp22oG7FFfNGvoR8LYAyv56tvnvdJc6wouLBaYpph/pub?gid=612792464&single=true&output=csv",
    econ:"https://docs.google.com/spreadsheets/d/e/2PACX-1vRd-F9AS2AOqG3-_39PX6jHwU-5fYDYuojWhuz07tZM7qkIxxCZriy-fQiqxmwYPFm3Za82g-dU1T7B/pub?gid=1189729527&single=true&output=csv",
    rashod:"https://docs.google.com/spreadsheets/d/e/2PACX-1vRd-F9AS2AOqG3-_39PX6jHwU-5fYDYuojWhuz07tZM7qkIxxCZriy-fQiqxmwYPFm3Za82g-dU1T7B/pub?gid=103296320&single=true&output=csv"
  },
  2: {
    arts:"https://docs.google.com/spreadsheets/d/e/2PACX-1vS4upRNoJpKgaEClkUgzfEBePMDEIYNBNHGO-iV5wqa0lzZPh1wLKuRw-fC2XDyc-kixxFbq4nPbKh9/pub?gid=612792464&single=true&output=csv",
    econ:"https://docs.google.com/spreadsheets/d/e/2PACX-1vQuVvUEHyqdVP2ZHULOoeNyKdJrnI5qHcp8EI9uEns-xFfRaH_OifbV4yZEqeS_1a7CBVKMQ2TYi9pp/pub?gid=1189729527&single=true&output=csv",
    rashod:"https://docs.google.com/spreadsheets/d/e/2PACX-1vQuVvUEHyqdVP2ZHULOoeNyKdJrnI5qHcp8EI9uEns-xFfRaH_OifbV4yZEqeS_1a7CBVKMQ2TYi9pp/pub?gid=103296320&single=true&output=csv"
  }
};
const PROF_DATA = {};
const parseRows = txt => {
  const delim=(txt.split(/\r?\n/,1)[0]||"").split(";").length>(txt.split(/\r?\n/,1)[0]||"").split(",").length?";":",";
  const rows=[];let row=[],f="",q=false;
  for(let i=0;i<txt.length;i++){const ch=txt[i];if(q){if(ch==='"'){if(txt[i+1]==='"'){f+='"';i++;}else q=false;}else f+=ch;}
    else if(ch==='"')q=true;else if(ch===delim){row.push(f);f="";}else if(ch==="\n"){row.push(f);rows.push(row);row=[];f="";}else if(ch!=="\r")f+=ch;}
  if(f.length||row.length){row.push(f);rows.push(row);}return rows;
};
const colIndex=(h,...names)=>{for(const x of names){let i=h.findIndex(v=>v===x);if(i>=0)return i;}for(const x of names){let i=h.findIndex(v=>v.includes(x));if(i>=0)return i;}return -1;};
const numRu=v=>n(String(v||"").replace(/\u00a0/g,"").replace(/\s/g,"").replace(",","."));
export async function loadProfitData(cab) {
  if(PROF_DATA[cab]) return PROF_DATA[cab];
  const src=IP_DATA[cab]; if(!src) return {};
  const [at,et,rt]=await Promise.all([src.arts,src.econ,src.rashod].map(async u=>{const r=await fetch(u);if(!r.ok)throw new Error("HTTP "+r.status);return r.text();}));
  const ar=parseRows(at), eh=parseRows(et), rh=parseRows(rt);
  const ah=(ar[0]||[]).map(x=>x.trim().toLowerCase()), arts={};
  const ia=colIndex(ah,"артикул поставщика","артикул"), ip=colIndex(ah,"предмет"), iv=colIndex(ah,"объём, л","объем, л","объём","объем","литр");
  for(const row of ar.slice(1)){const art=(row[ia]||"").trim();if(art) arts[norm(art)]={art,pred:(row[ip]||"").trim(),vol:numRu(row[iv])};}
  const econH=(eh[0]||[]).map(x=>x.trim().toLowerCase()), ik=colIndex(econH,"предмет;артикул","артикул"), post=colIndex(econH,"поступ","поставл"), econ={};
  for(const row of eh.slice(1)){const k=norm(row[ik>=0?ik:0]);if(k)econ[k]=numRu(row[post]);}
  const rashH=(rh[0]||[]).map(x=>x.trim().toLowerCase()), rk=colIndex(rashH,"предмет;артикул"), what=colIndex(rashH,"что"), sum=colIndex(rashH,"сумма"), rash={};
  for(const row of rh.slice(1)){if(norm(row[what])!=="товар")continue;const k=norm(row[rk>=0?rk:3]);if(k)rash[k]=(rash[k]||0)+numRu(row[sum]);}
  for(const a of Object.values(arts)){const k=norm((a.pred||"")+a.art),qty=econ[k]||0;a.cogs=qty>0?Math.round((rash[k]||0)/qty):0;}
  PROF_DATA[cab]=arts;return arts;
}

const readOverrides = () => { try { return JSON.parse(localStorage.getItem(LSKEY)||"{}"); } catch { return {}; } };
const writeOverrides = (v) => { try { localStorage.setItem(LSKEY,JSON.stringify(v)); } catch {} };
const norm = x => String(x||"").trim().toLowerCase().replace(/\s+/g,"");
const n = x => Number.isFinite(+x) ? +x : 0;
const money = x => Math.round(x).toLocaleString("ru-RU")+" ₽";
const pct = x => (x*100).toLocaleString("ru-RU",{maximumFractionDigits:1})+"%";
const iso = x => new Date(x).toISOString().slice(0,10);

function selectedOrders(vm,nCab) {
  const mode=CM[nCab]||"day";
  const all=vm.allOrders||[];
  const today=iso(Date.now());
  const start=mode==="month"?iso(Date.now()-30*864e5):mode==="week"?iso(Date.now()-7*864e5):mode==="yesterday"?iso(Date.now()-864e5):today;
  const end=mode==="yesterday"?today:iso(Date.now()+864e5);
  let rows=all.filter(o=>{const d=String(o.date||"").slice(0,10);return d>=start&&(mode==="yesterday"?d<today:d<end);});
  if((OFM[nCab]||"all")!=="all") rows=rows.filter(o=>String(o.warehouseType||"").toLowerCase().includes("склад wb") || String(o.warehouseType||"").toLowerCase()==="wb");
  const arts=FA[nCab]||[], subs=FP[nCab]||[], grps=FG[nCab]||[];
  return rows.filter(o=>{
    const a=o.supplierArticle||"",g=artGroup(a)||{};
    return (!arts.length||arts.some(x=>norm(x)===norm(a))) &&
      (!subs.length||subs.includes(o.subject||o.category||g.predmet||"")) &&
      (!grps.length||grps.includes(g.kratko||""));
  });
}
function logistic(vol,buy) {
  let base=0;
  if(vol>0&&vol<=.2)base=C.log_t20;
  else if(vol<=.4&&vol>0)base=C.log_t40;
  else if(vol<=.6&&vol>0)base=C.log_t60;
  else if(vol<=.8&&vol>0)base=C.log_t80;
  else if(vol<=1&&vol>0)base=C.log_t100;
  else if(vol>1)base=C.log_fbw_base1+C.log_fbw_addl*(vol-1);
  const forward=base*C.log_fbw_coef;
  return buy>0?(forward+(1-buy)*base)/buy:forward;
}
function compute({price,cogs,vol,buy,subject,ctr,cr,cab}) {
  const p=price, spp=0, priceDisc=p, priceSPP=priceDisc*(1-spp/100), wallet=priceSPP*C.wallet/100, site=priceSPP-wallet;
  const rec=COMM.find(x=>norm(x.pred)===norm(subject));
  const comm=rec?rec.fbw:C.comm_def_fbw;
  const realComm=Math.max(0,comm)*p/100;
  const transfer=spp-realComm-site*C.acquiring/100;
  const logistics=logistic(vol,buy);
  const prep=C.prep_box+C.prep_move_l*vol;
  const store=C.store_per_l*Math.max(1,vol)*C.log_fbw_coef*C.store_days;
  const tax=site*C.tax/100, vat=(cab===1?5:0)>0?site*5/105:0;
  const profitBeforeAds=transfer-cogs-C.fixed-logistics-prep-store-(C.ff_on?C.ff_flat:0)-tax-vat;
  const clicks=1000*ctr/100;
  const orders=Math.ceil(clicks*cr/100);
  const cpo=orders>0?500/orders:0;
  const cps=buy>0?cpo/buy:cpo;
  return {site,profit:profitBeforeAds-cps,profitBeforeAds,cps,comm,logistics};
}
function adMetrics(cab,art,orders) {
  const A=ADS[cab];
  if(!A||A.error) return {ctr:null,cr:10,source:"реклама не загружена"};
  const nmIds=new Set();
  for(const o of orders) if(norm(o.supplierArticle)===norm(art)&&o.nmId) nmIds.add(String(o.nmId));
  for(const nm of cardsNmList(cab)||[]) { const c=cardByNm(cab,nm); if(c&&norm(c.supplierArticle)===norm(art)) nmIds.add(String(nm)); }
  let views=0,clicks=0,adOrders=0;
  for(const id of nmIds) for(const [day,x] of Object.entries(A.nm[id]||{})) {
    if(day<A.from||day>A.to) continue;
    views+=n(x.views);clicks+=n(x.clicks);adOrders+=n(x.orders);
  }
  if(!views||!clicks) return {ctr:null,cr:10,source:"нет CTR SKU; реклама не учтена, CR 10%"};
  return {ctr:clicks/views*100,cr:adOrders>0?adOrders/clicks*100:10,source:adOrders>0?"CTR и CR по рекламе SKU":"CTR по рекламе SKU; CR 10%"};
}

export function profitabilityHTML(cab,vm) {
  if(cab===3||!vm||!sheets.loaded) return "";
  const rows=selectedOrders(vm,cab);
  const grouped=new Map();
  for(const o of rows) {
    const art=o.supplierArticle||"—"; if(art==="—") continue;
    const r=grouped.get(art)||{art,subject:o.subject||o.category||artGroup(art)?.predmet||"",qty:0,sum:0,orders:[]};
    const q=n(o.quantity)||1;r.qty+=q;r.sum+=wbPrice(o)*q;r.orders.push(o);grouped.set(art,r);
  }
  const overrides=readOverrides();
  const data=[...grouped.values()].sort((a,b)=>b.sum-a.sum);
  const body=data.map(r=>{
    const key=cab+"|"+norm(r.art), ov=overrides[key]||{};
    const br=getBuyrate(r.art), ref=PROF_DATA[cab]?.[norm(r.art)]||{}, buy=n(ov.buyout??br.val), cogs=n(ov.cogs??ref.cogs??0), vol=n(ref.vol);
    const ad=adMetrics(cab,r.art,r.orders);
    const calc=compute({price:r.sum/Math.max(1,r.qty),cogs,vol,buy,subject:r.subject,ctr:ad.ctr??0,cr:ad.cr,cab});
    const buySum=r.sum*buy, profitSum=r.qty*buy*calc.profit;
    const est=br.est&&!ov.buyout;
    return `<tr>
      <td><b>${r.art}</b><div class="sm2">${r.subject}</div></td>
      <td style="text-align:right">${r.qty}</td>
      <td><input type="number" min="0" max="100" step=".1" value="${(buy*100).toFixed(1)}" style="width:66px" onchange="App.setProfitInput(${cab},'${r.art.replace(/'/g,"\\'")}','buyout',this.value)">%</td>
      <td><input type="number" min="0" step="1" value="${cogs}" style="width:76px" onchange="App.setProfitInput(${cab},'${r.art.replace(/'/g,"\\'")}','cogs',this.value)"></td>
      <td style="text-align:right">${money(calc.profit)}</td>
      <td style="text-align:right">${money(r.sum)}</td>
      <td style="text-align:right">${money(buySum)}</td>
      <td style="text-align:right;font-weight:700;color:${profitSum>=0?"var(--green)":"var(--red)"}">${money(profitSum)}</td>
      <td class="sm2">${ad.source}${est?" · выкуп оценочный":""}</td>
    </tr>`;
  }).join("");
  const totalOrders=data.reduce((s,r)=>s+r.qty,0), totalSum=data.reduce((s,r)=>s+r.sum,0);
  const totalBuy=data.reduce((s,r)=>s+r.sum*(n(overrides[cab+"|"+norm(r.art)]?.buyout??getBuyrate(r.art).val)),0);
  const totalProfit=data.reduce((s,r)=>{
    const ov=overrides[cab+"|"+norm(r.art)]||{},br=getBuyrate(r.art);
    const ad=adMetrics(cab,r.art,r.orders),ref=PROF_DATA[cab]?.[norm(r.art)]||{},buy=n(ov.buyout??br.val),cogs=n(ov.cogs??ref.cogs??0),vol=n(ref.vol);
    const calc=compute({price:r.sum/Math.max(1,r.qty),cogs,vol,buy,subject:r.subject,ctr:ad.ctr??0,cr:ad.cr,cab});
    return s+r.qty*buy*calc.profit;
  },0);
  const period=(CM[cab]||"day")==="month"?"30 дней":(CM[cab]||"day")==="week"?"7 дней":(CM[cab]||"day")==="yesterday"?"вчера":"сегодня";
  return `<div class="sec" id="profitability${cab}">
    <div class="sh"><span class="st">Прибыльность заказов · FBW</span><span class="sm2">${period} · ${totalOrders} шт.</span></div>
    <div class="sm2" style="margin:4px 0 8px">Расчёт по модели калькулятора. Цена заказа используется как исходная цена; объём и себестоимость подтягиваются из справочника калькулятора. Себестоимость и выкуп можно менять прямо в таблице.</div>
    <div class="tw"><table><thead><tr><th>Артикул</th><th>Заказано, шт.</th><th>Выкуп</th><th>Себест., ₽</th><th>Прибыль/выкуп, ₽</th><th>Сумма заказов</th><th>Ожид. выкуп, ₽</th><th>Ожид. прибыль</th><th>Реклама / данные</th></tr></thead><tbody>${body||'<tr><td colspan="9" class="em">Нет заказов FBW за выбранный период</td></tr>'}
    <tr style="border-top:2px solid var(--border2);font-weight:700"><td>Итого</td><td>${totalOrders}</td><td>—</td><td>—</td><td>—</td><td style="text-align:right">${money(totalSum)}</td><td style="text-align:right">${money(totalBuy)}</td><td style="text-align:right">${money(totalProfit)}</td><td></td></tr>
    </tbody></table></div>
  </div>`;
}
export function repaintProfitability(cab,vm) { const el=document.getElementById("profitability"+cab); if(el&&vm) el.outerHTML=profitabilityHTML(cab,vm); }\n\nexport function setProfitInput(cab,art,field,value) {
  const all=readOverrides(),key=cab+"|"+norm(art),o=all[key]||{};
  o[field]=field==="buyout"?Math.max(0,Math.min(1,n(value)/100)):Math.max(0,n(value));
  all[key]=o;writeOverrides(all);
}
