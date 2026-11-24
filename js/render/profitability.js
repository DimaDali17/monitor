import { CM, FA, FP, FG } from "../state.js";
import { sheets, getBuyrate, artGroup } from "../api/sheets.js";
import { ADS } from "../api/ads.js";
import { cardByNm, cardsNmList } from "../api/wb.js";
import { wbPrice, esc } from "../utils.js";

const LSKEY = "monitor_profit_overrides_v2";
const OPENKEY = "monitor_profit_open_v2";
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
const PROF_DATA = {};\nconst LAST_VM = {};
const DEFAULT = {
  disc:0,spp:0,buyout:null,cogs:null,vol:null,commission:null,
  wallet:3,acquiring:3,tax:6,vat:null,fixed:60,
  log_fbw_base1:46,log_fbw_addl:14,log_fbw_coef:1.7,
  log_t20:23,log_t40:26,log_t60:29,log_t80:30,log_t100:32,
  prep_box:5,prep_move_l:7,ff_on:1,ff_flat:50,
  store_per_l:0.08,store_days:0,ad_bid:500,ad_ctr:null,ad_cr:10
};
const COMM = {"термоноски":39.5,"термокомплекты":34.5,"трусы":43.5,"термомайки":43.5,"леггинсы":43.5};
const n = x => Number.isFinite(Number(x)) ? Number(x) : 0;
const norm = x => String(x||"").trim().toLowerCase().replace(/\\s+/g,"");
const money = x => Math.round(x).toLocaleString("ru-RU")+" ₽";
const fmt = x => (Math.round(x*10)/10).toLocaleString("ru-RU");
const pct = x => fmt(x*100)+"%";
const read = key => { try{return JSON.parse(localStorage.getItem(key)||"{}");}catch{return {};} };
const write = (key,v) => { try{localStorage.setItem(key,JSON.stringify(v));}catch{} };
const overrides = () => read(LSKEY);
const opened = () => read(OPENKEY);
const keyOf = (cab,art) => cab+"|"+norm(art);
const parseCSV = txt => {
  const delim=(txt.split(/\\r?\\n/,1)[0]||"").split(";").length>(txt.split(/\\r?\\n/,1)[0]||"").split(",").length?";":",";
  const rows=[];let row=[],f="",q=false;
  for(let i=0;i<txt.length;i++){const c=txt[i];if(q){if(c==='"'){if(txt[i+1]==='"'){f+='"';i++;}else q=false;}else f+=c;}
    else if(c==='"')q=true;else if(c===delim){row.push(f);f="";}else if(c==="\\n"){row.push(f);rows.push(row);row=[];f="";}else if(c!=="\\r")f+=c;}
  if(f.length||row.length){row.push(f);rows.push(row);}return rows;
};
const col = (h,...names) => {for(const x of names){const i=h.findIndex(v=>v===x);if(i>=0)return i;}for(const x of names){const i=h.findIndex(v=>v.includes(x));if(i>=0)return i;}return -1;};
const numRu = v => {const x=parseFloat(String(v??"").replace(/\\u00a0/g,"").replace(/\\s/g,"").replace(",", "."));return Number.isFinite(x)?x:0;};

export async function loadProfitData(cab) {
  if(PROF_DATA[cab])return PROF_DATA[cab];
  const src=IP_DATA[cab];if(!src)return {};
  const [at,et,rt]=await Promise.all([src.arts,src.econ,src.rashod].map(async u=>{const r=await fetch(u);if(!r.ok)throw new Error("HTTP "+r.status);return r.text();}));
  const ar=parseCSV(at), er=parseCSV(et), rr=parseCSV(rt);
  const ah=(ar[0]||[]).map(x=>x.trim().toLowerCase()), arts={};
  const ia=col(ah,"артикул поставщика","артикул"), ip=col(ah,"предмет"), iv=col(ah,"объём, л","объем, л","объём","объем","литр");
  for(const row of ar.slice(1)){const art=(row[ia]||"").trim();if(art)arts[norm(art)]={art,pred:(row[ip]||"").trim(),vol:numRu(row[iv]),cogs:0};}
  const eh=(er[0]||[]).map(x=>x.trim().toLowerCase()), ik=col(eh,"предмет;артикул","артикул"), post=col(eh,"поступ","поставл"), econ={};
  for(const row of er.slice(1)){const k=norm(row[ik>=0?ik:0]);if(k)econ[k]=numRu(row[post]);}
  const rh=(rr[0]||[]).map(x=>x.trim().toLowerCase());let rk=col(rh,"предмет;артикул");if(rk<0)rk=rh.findIndex(x=>x.includes(";"));if(rk<0)rk=3;
  const what=col(rh,"что"),sum=col(rh,"сумма"),rash={};
  for(const row of rr.slice(1)){if(norm(row[what])!=="товар")continue;const k=norm(row[rk]);if(k)rash[k]=(rash[k]||0)+numRu(row[sum]);}
  for(const a of Object.values(arts)){const k=norm((a.pred||"")+a.art),qty=econ[k]||0;a.cogs=qty>0?Math.round((rash[k]||0)/qty):0;}
  PROF_DATA[cab]=arts;return arts;
}
function dateKey(v){const d=new Date(v);return Number.isNaN(+d)?"":d.toISOString().slice(0,10);}
function selectedOrders(vm,cab){
  const mode=CM[cab]||"day", all=vm.allOrders||[], today=new Date().toISOString().slice(0,10);
  const start=mode==="month"?dateKey(Date.now()-30*864e5):mode==="week"?dateKey(Date.now()-7*864e5):mode==="yesterday"?dateKey(Date.now()-864e5):today;
  const end=mode==="yesterday"?today:dateKey(Date.now()+864e5);
  let rows=all.filter(o=>{const d=String(o.date||"").slice(0,10);return d>=start&&(mode==="yesterday"?d<today:d<end);});
  rows=rows.filter(o=>{const w=String(o.warehouseType||"").toLowerCase();return w.includes("склад wb")||w==="wb";});
  const arts=FA[cab]||[],subs=FP[cab]||[],groups=FG[cab]||[];
  return rows.filter(o=>{const a=o.supplierArticle||"",g=artGroup(a)||{};return (!arts.length||arts.some(x=>norm(x)===norm(a)))&&(!subs.length||subs.includes(o.subject||o.category||g.predmet||""))&&(!groups.length||groups.includes(g.kratko||""));});
}
function adMetrics(cab,art,orders){
  const A=ADS[cab];if(!A||A.error)return {ctr:null,cr:10,source:"рекламная статистика не загружена"};
  const ids=new Set();
  for(const o of orders)if(norm(o.supplierArticle)===norm(art)&&o.nmId)ids.add(String(o.nmId));
  for(const nm of cardsNmList(cab)||[]){const c=cardByNm(cab,nm);if(c&&norm(c.supplierArticle)===norm(art))ids.add(String(nm));}
  let views=0,clicks=0,ordersAd=0;
  for(const id of ids)for(const [day,x] of Object.entries(A.nm[id]||{})){if(day<A.from||day>A.to)continue;views+=n(x.views);clicks+=n(x.clicks);ordersAd+=n(x.orders);}
  if(!views||!clicks)return {ctr:null,cr:10,source:"нет CTR по SKU, реклама не списана; CR 10%"};
  return {ctr:clicks/views,cr:ordersAd>0?ordersAd/clicks:0.10,source:ordersAd>0?"CTR и CR по рекламе SKU":"CTR по SKU; CR 10%"};
}
function calc(st){
  const b=Math.max(0,Math.min(1,st.buyout/100));
  const priceDisc=st.price*(1-st.disc/100),priceSPP=priceDisc*(1-st.spp/100);
  const wallet=priceSPP*st.wallet/100,site=priceSPP-wallet,acquiring=site*st.acquiring/100;
  const realCommPct=Math.max(0,st.commission-st.spp),commRub=priceDisc*realCommPct/100;
  const transfer=priceSPP-commRub-acquiring;
  const vol=st.vol;let base=0,mode="zero",tarif=0,dop=0;
  if(vol>0&&vol<=1){mode="small";tarif=vol<=.2?st.log_t20:vol<=.4?st.log_t40:vol<=.6?st.log_t60:vol<=.8?st.log_t80:st.log_t100;base=tarif;}
  else if(vol>1){mode="big";dop=vol-1;base=st.log_fbw_base1+st.log_fbw_addl*dop;}
  const logFwd=base*st.log_fbw_coef, logReturn=(1-b)*base, logistics=b>0?(logFwd+logReturn)/b:logFwd;
  const prepBox=st.prep_box,prepMove=st.prep_move_l*vol,prep=prepBox+prepMove;
  const store=st.store_per_l*Math.max(1,vol)*st.log_fbw_coef*st.store_days;
  const ff=st.ff_on?st.ff_flat:0,tax=site*st.tax/100,vat=st.vat>0?site*st.vat/(100+st.vat):0;
  const profit0=transfer-st.cogs-st.fixed-logistics-prep-store-ff-tax-vat;
  const ctr=st.ctr==null?0:st.ctr,clicks=1000*ctr/100,ordersAd=ctr>0?Math.ceil(clicks*st.cr/100):0;
  const cpo=ordersAd>0?st.ad_bid/ordersAd:0,cps=b>0?cpo/b:cpo,drr=priceSPP>0?cps/priceSPP:0;
  return {priceDisc,priceSPP,wallet,site,acquiring,realCommPct,commRub,transfer,base,tarif,dop,logFwd,logReturn,logistics,prepBox,prepMove,prep,store,ff,tax,vat,profit0,clicks,ordersAd,cpo,cps,drr,profit:profit0-cps,margin:site>0?(profit0-cps)/site:0};
}
function input(cab,art,field,value){
  const all=overrides(),k=keyOf(cab,art);all[k]={...(all[k]||{}),[field]:value===""?0:Number(value)};write(LSKEY,all);
  const vm=LAST_VM[cab];if(vm)repaintProfitability(cab,vm);
}
function toggle(cab,art){
  const all=opened(),k=keyOf(cab,art);all[k]=!all[k];write(OPENKEY,all);
  const vm=window.__monitorVM?.[cab];if(vm)repaintProfitability(cab,vm);
}
function field(cab,art,st,name,label,step="1",suffix=""){
  const v=st[name]??0;
  return '<label class="pf-field"><span>'+label+'</span><div><input type="number" step="'+step+'" value="'+v+'" onchange="App.setProfitInput('+cab+',\''+esc(art)+'\',\''+name+'\',this.value)">'+suffix+'</div></label>';
}
function row(label,value,cls=""){
  return '<tr class="'+cls+'"><td>'+label+'</td><td>'+value+'</td></tr>';
}
function detail(cab,r,st,z,ad){
  const k=keyOf(cab,r.art),p=(v)=>money(v),neg=(v)=>"−"+p(Math.abs(v));
  const section=(name)=>row(name,"","pf-section");
  const rows=[
    section("Выручка"),
    row("Цена продавца",p(st.price)),row("− скидка продавца "+fmt(st.disc)+"%",neg(st.price*st.disc/100)),
    row("Цена со скидкой",p(z.priceDisc),"pf-total"),row("− СПП "+fmt(st.spp)+"%",neg(st.priceDisc*st.spp/100)),
    row("Цена с СПП",p(z.priceSPP)),row("− WB-кошелёк "+fmt(st.wallet)+"%",neg(z.wallet)),row("Цена на сайте",p(z.site),"pf-total"),
    section("Удержания WB"),row("КВВ номинальная",fmt(st.commission)+"%"),row("Реальная комиссия (КВВ − СПП)",neg(z.commRub)),row("Эквайринг "+fmt(st.acquiring)+"%",neg(z.acquiring)),row("Цена к перечислению",p(z.transfer),"pf-total"),
    section("Логистика FBW"),row("Объём",fmt(st.vol)+" л"),row(z.tarif?"Тариф по объёму":"База логистики",p(z.base)),row("Коэффициент склада", "× "+fmt(st.log_fbw_coef)),row("Логистика вперёд",p(z.logFwd)),row("Отправок на 1 выкуп",st.buyout>0?fmt(100/st.buyout)+" шт":"—"),row("Возвраты на выкуп",neg(z.logReturn)),row("Логистика с выкупом",neg(z.logistics),"pf-total"),
    section("Приёмка и прочие расходы"),row("Обработка короба",neg(z.prepBox)),row("Перемещение",neg(z.prepMove)),row("Итого приёмка",neg(z.prep),"pf-total"),row("Себестоимость товара",neg(st.cogs)),row("Хранение",neg(z.store)),row("ФФ (DarkStore)",neg(z.ff)),row("Постоянные расходы",neg(st.fixed)),row("Налог "+fmt(st.tax)+"%",neg(z.tax)),row("НДС "+fmt(st.vat)+"%",neg(z.vat)),
    row("Прибыль до рекламы",p(z.profit0),"pf-total"),section("Реклама и итог"),row("CTR",st.ctr==null?"нет данных":fmt(st.ctr)+"%"),row("CR",fmt(st.cr*100)+"%"),row("Заказов на 1000 показов",z.ordersAd+" шт"),row("Ставка / 1000 показов",p(st.ad_bid)),row("CPO",p(z.cpo)),row("CPS на выкуп",neg(z.cps)),row("ДРР",pct(z.drr)),row("Прибыль с продажи",p(z.profit),"pf-total"),row("Маржинальность",pct(z.margin),"pf-total")
  ];
  const editable='<div class="pf-edit-grid">'+
    field(cab,r.art,st,"price","Цена продавца, ₽")+
    field(cab,r.art,st,"disc","Скидка продавца, %","0.1")+
    field(cab,r.art,st,"spp","СПП, %","0.1")+
    field(cab,r.art,st,"buyout","Выкуп, %","0.1")+
    field(cab,r.art,st,"cogs","Себестоимость, ₽")+
    field(cab,r.art,st,"vol","Объём, л","0.001")+
    field(cab,r.art,st,"commission","КВВ, %","0.1")+
    field(cab,r.art,st,"wallet","WB-кошелёк, %","0.1")+
    field(cab,r.art,st,"acquiring","Эквайринг, %","0.1")+
    field(cab,r.art,st,"tax","Налог, %","0.1")+
    field(cab,r.art,st,"vat","НДС, %","0.1")+
    field(cab,r.art,st,"fixed","Постоянные, ₽")+
    field(cab,r.art,st,"log_fbw_base1","Логистика: 1-й литр, ₽","0.1")+
    field(cab,r.art,st,"log_fbw_addl","Доп. литр, ₽","0.1")+
    field(cab,r.art,st,"log_fbw_coef","Коэффициент склада","0.01")+
    field(cab,r.art,st,"prep_box","Обработка короба, ₽","0.1")+
    field(cab,r.art,st,"prep_move_l","Перемещение, ₽/л","0.1")+
    field(cab,r.art,st,"ff_flat","ФФ, ₽")+
    field(cab,r.art,st,"store_days","Хранение, дней")+
    field(cab,r.art,st,"ad_bid","Ставка / 1000, ₽")+
    field(cab,r.art,st,"ad_cr","CR, %","0.1")+
    '</div><div class="pf-note">CTR: '+ad.source+'. Если CTR не найден, расходы на рекламу равны нулю, а CR принят 10% до появления фактических данных. Значения сохраняются в этом браузере.</div>';
  return '<tr class="pf-detail-row"><td colspan="9"><div class="pf-detail"><div><div class="pf-detail-title">Экономика по шагам · '+esc(r.art)+'</div>'+editable+'</div><div class="pf-steps"><table><tbody>'+rows.join("")+'</tbody></table></div></div></td></tr>';
}
export function profitabilityHTML(cab,vm){
  if(cab===3||!vm||!sheets.loaded)return "";
  const orders=selectedOrders(vm,cab),grouped=new Map();
  for(const o of orders){const art=o.supplierArticle||"—";if(art==="—")continue;const x=grouped.get(art)||{art,subject:o.subject||o.category||artGroup(art)?.predmet||"",qty:0,sum:0,price:0,disc:0,orders:[]};const q=n(o.quantity)||1;x.qty+=q;x.sum+=wbPrice(o)*q;x.price+=(n(o.totalPrice)||wbPrice(o))*q;x.disc+=(n(o.discountPercent)||0)*q;x.orders.push(o);grouped.set(art,x);}
  const all=overrides(),open=opened(),data=[...grouped.values()].sort((a,b)=>b.sum-a.sum);
  const records=data.map(r=>{
    const ov=all[keyOf(cab,r.art)]||{},ref=PROF_DATA[cab]?.[norm(r.art)]||{},br=getBuyrate(r.art),ad=adMetrics(cab,r.art,r.orders);
    const price= n(ov.price??(r.price/Math.max(1,r.qty)));
    const st={...DEFAULT,...ov,price,disc:n(ov.disc??r.disc/Math.max(1,r.qty)),spp:n(ov.spp??0),buyout:n(ov.buyout??(br.val*100)),cogs:n(ov.cogs??ref.cogs??0),vol:n(ov.vol??ref.vol??0),commission:n(ov.commission??COMM[norm(r.subject)]??40),tax:n(ov.tax??6),vat:n(ov.vat??(cab===1?5:0)),ctr:ov.ad_ctr!=null?n(ov.ad_ctr)/100:ad.ctr,cr:n(ov.ad_cr??ad.cr*100)/100,ad_bid:n(ov.ad_bid??500),ff_on:n(ov.ff_on??0)};
    const z=calc(st),buySum=r.sum*(st.buyout/100),profitSum=r.qty*(st.buyout/100)*z.profit;
    return {r,st,z,ad,buySum,profitSum,expanded:!!open[keyOf(cab,r.art)]};
  });
  const body=records.map(({r,st,z,ad,buySum,profitSum,expanded})=>{
    const color=profitSum>=0?"var(--green)":"var(--red)";
    return '<tr class="pf-main-row"><td><button class="pf-expand" onclick="App.toggleProfit('+cab+',\''+esc(r.art)+'\')">'+(expanded?"−":"+")+'</button><b>'+esc(r.art)+'</b><div class="sm2">'+esc(r.subject)+'</div></td><td>'+r.qty+'</td><td>'+fmt(st.buyout)+'%</td><td>'+money(st.cogs)+'</td><td>'+money(z.profit)+'</td><td>'+money(r.sum)+'</td><td>'+money(buySum)+'</td><td style="color:'+color+';font-weight:700">'+money(profitSum)+'</td><td class="sm2">'+esc(ad.source)+'</td></tr>'+(expanded?detail(cab,r,st,z,ad):"");
  }).join("");
  const qty=records.reduce((s,x)=>s+x.r.qty,0),sum=records.reduce((s,x)=>s+x.r.sum,0),buy=records.reduce((s,x)=>s+x.buySum,0),profit=records.reduce((s,x)=>s+x.profitSum,0);
  const mode=CM[cab]||"day",period=mode==="month"?"30 дней":mode==="week"?"7 дней":mode==="yesterday"?"вчера":"сегодня";
  return '<div class="sec" id="profitability'+cab+'"><style>'+
    '#profitability'+cab+' .pf-main-row td{vertical-align:middle}'+
    '#profitability'+cab+' .pf-expand{border:1px solid var(--border2);background:#fff;border-radius:4px;width:23px;height:23px;margin-right:7px;cursor:pointer;font-size:15px;color:var(--ink2)}'+
    '#profitability'+cab+' .pf-detail-row>td{padding:0!important;background:#f8f6f1}'+
    '#profitability'+cab+' .pf-detail{display:grid;grid-template-columns:minmax(460px,1fr) minmax(360px,1fr);gap:16px;padding:16px;border-top:1px solid var(--border2);border-bottom:1px solid var(--border2)}'+
    '#profitability'+cab+' .pf-detail-title{font-weight:700;margin:0 0 12px;color:var(--ink)}'+
    '#profitability'+cab+' .pf-edit-grid{display:grid;grid-template-columns:repeat(3,minmax(110px,1fr));gap:8px}'+
    '#profitability'+cab+' .pf-field{display:block;font-size:10px;color:var(--ink2)}'+
    '#profitability'+cab+' .pf-field span{display:block;margin-bottom:3px}'+
    '#profitability'+cab+' .pf-field input{width:100%;box-sizing:border-box;border:1px solid var(--border2);border-radius:5px;background:white;padding:6px 7px;font:inherit;font-size:12px;color:var(--ink)}'+
    '#profitability'+cab+' .pf-steps{max-height:650px;overflow:auto}'+
    '#profitability'+cab+' .pf-steps table{width:100%;border-collapse:collapse;font-size:11px}'+
    '#profitability'+cab+' .pf-steps td{padding:5px 8px;border-bottom:1px solid #e4dfd5}'+
    '#profitability'+cab+' .pf-steps td:last-child{text-align:right;white-space:nowrap;font-weight:600}'+
    '#profitability'+cab+' .pf-section td{background:#e9e3d8;color:#514b41;font-weight:700;padding-top:8px}'+
    '#profitability'+cab+' .pf-total td{font-weight:700;background:#f0ece4}'+
    '#profitability'+cab+' .pf-note{font-size:10px;color:var(--ink3);margin-top:10px;line-height:1.5}'+
    '@media(max-width:900px){#profitability'+cab+' .pf-detail{grid-template-columns:1fr}#profitability'+cab+' .pf-edit-grid{grid-template-columns:repeat(2,minmax(100px,1fr))}}'+
    '</style><div class="sh"><span class="st">Прибыльность заказов · FBW</span><span class="sm2">'+period+' · '+qty+' шт.</span></div>'+
    '<div class="sm2" style="margin:4px 0 8px">Расчёт по модели Calculate. Нажми «+» у артикула, чтобы раскрыть полную экономику и редактировать параметры. Цена продавца и скидка берутся из полей заказов WB; СПП не передаётся в истории заказов и по умолчанию равна 0%, пока не задана вручную.</div>'+
    '<div class="tw"><table><thead><tr><th>Артикул</th><th>Заказано, шт.</th><th>Выкуп</th><th>Себест., ₽</th><th>Прибыль/выкуп, ₽</th><th>Сумма заказов</th><th>Ожид. выкуп, ₽</th><th>Ожид. прибыль</th><th>Реклама / данные</th></tr></thead><tbody>'+(body||'<tr><td colspan="9" class="em">Нет заказов FBW за выбранный период</td></tr>')+'<tr style="border-top:2px solid var(--border2);font-weight:700"><td>Итого</td><td>'+qty+'</td><td>—</td><td>—</td><td>—</td><td style="text-align:right">'+money(sum)+'</td><td style="text-align:right">'+money(buy)+'</td><td style="text-align:right;color:'+(profit>=0?"var(--green)":"var(--red)")+'">'+money(profit)+'</td><td></td></tr></tbody></table></div></div>';
}
export function repaintProfitability(cab,vm){const el=document.getElementById("profitability"+cab);if(el&&vm)el.outerHTML=profitabilityHTML(cab,vm);}
export function setProfitInput(cab,art,field,value){input(cab,art,field,value);}
export function toggleProfit(cab,art){toggle(cab,art);}
