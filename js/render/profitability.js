import { CM } from "../state.js";
import { sheets, getBuyrate, artGroup } from "../api/sheets.js";
import { ADS } from "../api/ads.js";
import { cardByNm, cardsNmList } from "../api/wb.js";
import { wbPrice, esc, iso } from "../utils.js";

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
const PROF_DATA = {};
const LAST_VM = {};
const SORT = {};
const TABLE_HIDDEN = {};
const DEFAULT = {
  disc:0,spp:31,buyout:null,cogs:null,vol:null,commission:null,
  wallet:3,acquiring:3,tax:6,vat:null,fixed:60,
  log_fbw_base1:46,log_fbw_addl:14,log_fbw_coef:1.7,
  log_t20:23,log_t40:26,log_t60:29,log_t80:30,log_t100:32,
  prep_box:5,prep_move_l:7,ff_on:0,ff_flat:50,
  store_per_l:0.08,store_days:60,ad_enabled:0,ad_bid:500,ad_ctr:5.6145,ad_cr:10
};
const COGS_GROUPS = [
  ["TermoMai.EF.Black1","TermoMai.EF.Beige1","TermoMai.EF.Grey1"],
  ["TS21num1","TS21num3","TS21num4","TS26num3new"],
  ["TermSocks.Al-ESS.black.01","TermSocks.Al-ESS.grey.01","TermSocks.Al-ESS.purp.01"],
  ["TermSocks.EF.Rab.01","TermSocks.EF.Rab.02","TermSocks.EF.Rab.03","TermSocks.EF.Rab.04"],
  ["TermSocks.Kash.Assor.01","TermSocks.Kash.Assor.04"],
  ["TermShort.new.SK.black.01","TermShort.new.SK.beige.01"]
];
const COMM = {"термоноски":39.5,"термокомплекты":34.5,"трусы":43.5,"термомайки":43.5,"леггинсы":43.5};
const n = x => Number.isFinite(Number(x)) ? Number(x) : 0;
const norm = x => String(x||"").trim().toLowerCase().replace(/\s+/g,"");
const money = x => Math.round(x).toLocaleString("ru-RU")+" ₽";
const fmt = x => (Math.round(x*10)/10).toLocaleString("ru-RU");
const pct = x => fmt(x*100)+"%";
const read = key => { try{return JSON.parse(localStorage.getItem(key)||"{}");}catch{return {};} };
const write = (key,v) => { try{localStorage.setItem(key,JSON.stringify(v));}catch{} };
const overrides = () => read(LSKEY);
const opened = () => read(OPENKEY);
const keyOf = (cab,art) => cab+"|"+norm(art);
function cogsValue(cab,art,ov,allOverrides){
  const own=n(ov.cogs??PROF_DATA[cab]?.[norm(art)]?.cogs??0);
  if(own>0)return own;
  const group=COGS_GROUPS.find(xs=>xs.some(x=>norm(x)===norm(art)));
  if(!group)return own;
  for(const sibling of group){
    if(norm(sibling)===norm(art))continue;
    const value=n(allOverrides[keyOf(cab,sibling)]?.cogs);
    if(value>0)return value;
  }
  for(const sibling of group){
    if(norm(sibling)===norm(art))continue;
    const value=n(PROF_DATA[cab]?.[norm(sibling)]?.cogs);
    if(value>0)return value;
  }
  return own;
}
const parseCSV = txt => {
  const first=(txt.split("\n",1)[0]||"");
  const delim=first.split(";").length>first.split(",").length?";":",";
  const rows=[];let row=[],f="",q=false;
  for(let i=0;i<txt.length;i++){const c=txt[i];if(q){if(c==='"'){if(txt[i+1]==='"'){f+='"';i++;}else q=false;}else f+=c;}
    else if(c==='"')q=true;else if(c===delim){row.push(f);f="";}else if(c==="\n"){row.push(f);rows.push(row);row=[];f="";}else if(c!=="\r")f+=c;}
  if(f.length||row.length){row.push(f);rows.push(row);}return rows;
};
const col = (h,...names) => {for(const x of names){const i=h.findIndex(v=>v===x);if(i>=0)return i;}for(const x of names){const i=h.findIndex(v=>v.includes(x));if(i>=0)return i;}return -1;};
const numRu = v => {const x=parseFloat(String(v??"").replace(/\u00a0/g,"").replace(/\s/g,"").replace(",", "."));return Number.isFinite(x)?x:0;};

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
export function profitabilityOrders(vm,cab){
  const mode=CM[cab]||"day";
  if(mode==="week")return vm.orders7||[];
  if(mode==="yesterday")return vm.yestO||[];
  if(mode==="month"){
    const start=iso(Date.now()-30*864e5);
    return (vm.allOrders||[]).filter(o=>String(o.date||"").slice(0,10)>=start);
  }
  return vm.todayO||[];
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
  const ctr=st.ctr==null?0:st.ctr,clicks=1000*ctr,ordersAd=ctr>0?Math.ceil(clicks*st.cr):0;
  const cpo=ordersAd>0?st.ad_bid/ordersAd:0,cps=st.ad_enabled? (b>0?cpo/b:cpo):0,drr=priceSPP>0?cps/priceSPP:0;
  return {priceDisc,priceSPP,wallet,site,acquiring,realCommPct,commRub,transfer,base,tarif,dop,logFwd,logReturn,logistics,prepBox,prepMove,prep,store,ff,tax,vat,profit0,clicks,ordersAd,cpo,cps,drr,profit:profit0-cps,margin:site>0?(profit0-cps)/site:0};
}
function estimateSettings(cab,r,all){
  const ov=all[keyOf(cab,r.art)]||{},ref=PROF_DATA[cab]?.[norm(r.art)]||{},br=getBuyrate(r.art);
  const st={...DEFAULT,...ov,price:n(ov.price??(r.price/Math.max(1,r.qty))),
    disc:Math.round(n(ov.disc??r.disc/Math.max(1,r.qty))),spp:n(ov.spp??31),
    buyout:n(ov.buyout??Math.round(br.val*100)),cogs:cogsValue(cab,r.art,ov,all),vol:n(ov.vol??ref.vol??0),
    commission:n(ov.commission??COMM[norm(r.subject)]??40),tax:n(ov.tax??6),
    vat:n(ov.vat??(cab===1?5:0)),ad_ctr:n(ov.ad_ctr??DEFAULT.ad_ctr),
    ctr:n(ov.ad_ctr??DEFAULT.ad_ctr)/100,cr:n(ov.ad_cr??DEFAULT.ad_cr)/100,
    ad_enabled:n(ov.ad_enabled??DEFAULT.ad_enabled),ad_bid:n(ov.ad_bid??DEFAULT.ad_bid),ff_on:n(ov.ff_on??0)};
  return {st,z:calc(st)};
}
export function expectedProfitByArticle(cab,orders){
  const grouped=new Map();
  for(const o of orders||[]){
    const art=o.supplierArticle||"—";if(art==="—")continue;
    const x=grouped.get(art)||{art,subject:o.subject||o.category||artGroup(art)?.predmet||"",qty:0,price:0,disc:0};
    const q=n(o.quantity)||1;x.qty+=q;x.price+=(n(o.totalPrice)||wbPrice(o))*q;x.disc+=(n(o.discountPercent)||0)*q;grouped.set(art,x);
  }
  const all=overrides();
  const result=new Map();
  for(const r of grouped.values()){
    const {st,z}=estimateSettings(cab,r,all);
    const perUnit=(st.buyout/100)*z.profit;
    result.set(r.art,{perUnit,total:r.qty*perUnit});
  }
  return result;
}
function input(cab,art,field,value){
  const all=overrides(),k=keyOf(cab,art);all[k]={...(all[k]||{}),[field]:value===""?0:Number(value)};write(LSKEY,all);
  const vm=LAST_VM[cab];if(vm)repaintProfitability(cab,vm);
}
function toggle(cab,art){
  const all=opened(),k=keyOf(cab,art);all[k]=!all[k];write(OPENKEY,all);
  const vm=LAST_VM[cab];if(vm)repaintProfitability(cab,vm);
}
function field(cab,art,st,name,label,step="1",suffix=""){
  const v=st[name]??0;
  return '<label class="pf-field"><span>'+label+'</span><div><input type="number" step="'+step+'" value="'+v+'" onchange="App.setProfitInput('+cab+',\''+esc(art)+'\',\''+name+'\',this.value)">'+suffix+'</div></label>';
}
function row(label,value,cls=""){
  return '<tr class="'+cls+'"><td>'+label+'</td><td>'+value+'</td></tr>';
}
function detail(cab,r,st,z){
  const fields=[
    ["price","Цена продавца, ₽"],["disc","Скидка продавца, %"],["spp","СПП, %"],["buyout","Выкуп, %"],
    ["cogs","Себестоимость, ₽"],["vol","Объём, л"],["commission","Комиссия WB, %"],
    ["wallet","WB-кошелёк, %"],["acquiring","Эквайринг, %"],["tax","Налог, %"],["vat","НДС, %"],
    ["fixed","Постоянные, ₽"],["log_fbw_base1","Логистика: первый литр, ₽"],["log_fbw_addl","Доп. литр, ₽"],
    ["log_fbw_coef","Коэффициент склада"],["prep_box","Приёмка: короб, ₽"],["prep_move_l","Перемещение, ₽/л"],
    ["ff_flat","Фулфилмент, ₽"],["ff_on","Фулфилмент включён (1/0)"],
    ["store_per_l","Хранение, ₽/л/день"],["store_days","Хранение, дней"],
    ["log_t20","Тариф до 0,2 л"],["log_t40","Тариф до 0,4 л"],["log_t60","Тариф до 0,6 л"],
    ["log_t80","Тариф до 0,8 л"],["log_t100","Тариф до 1 л"],
    ["ad_bid","CPM / ставка за 1000 показов, ₽"],["ad_ctr","CTR рекламы, %"],["ad_cr","CR из клика в заказ, %"]
  ];
  const editable=fields.map(([name,label])=>field(cab,r.art,st,name,label,
    ["vol","log_fbw_coef","store_per_l","ad_cr","spp","buyout","commission","wallet","acquiring","tax","vat","log_fbw_addl","prep_move_l"].includes(name)?"0.1":name==="ad_ctr"?"0.0001":"1"
  )).join("");
  return '<tr class="pf-settings-row"><td colspan="19"><details open><summary>Настройки расчёта · '+esc(r.art)+' <span class="pf-note-inline">СПП по умолчанию 31%, все параметры можно менять</span></summary><div class="pf-edit-grid">'+editable+'</div><div class="pf-note">Изменения сохраняются в этом браузере. Реклама рассчитывается по модели: ставка ÷ расчётные заказы от 1000 показов ÷ выкуп. Старт: 500 ₽, CTR 5,6145%, CR 10%; можно менять для артикула.</div></details></td></tr>';
}
export function profitabilityHTML(cab,vm){
  if(cab===3||!vm||!sheets.loaded)return "";
  LAST_VM[cab]=vm;
  const orders=profitabilityOrders(vm,cab),grouped=new Map();
  for(const o of orders){
    const art=o.supplierArticle||"—";if(art==="—")continue;
    const x=grouped.get(art)||{art,subject:o.subject||o.category||artGroup(art)?.predmet||"",qty:0,sum:0,price:0,disc:0,orders:[]};
    const q=n(o.quantity)||1;x.qty+=q;x.sum+=wbPrice(o)*q;x.price+=(n(o.totalPrice)||wbPrice(o))*q;x.disc+=(n(o.discountPercent)||0)*q;x.orders.push(o);grouped.set(art,x);
  }
  const all=overrides(),data=[...grouped.values()].sort((a,b)=>b.sum-a.sum),profitByArticle=expectedProfitByArticle(cab,orders);
  const records=data.map(r=>{
    const {st,z}=estimateSettings(cab,r,all),buySum=r.sum*(st.buyout/100),profitSum=profitByArticle.get(r.art)?.total||0;
    return {r,st,z,buySum,profitSum};
  });
  const cellInput=(cab,art,st,name,step="1")=>'<input class="pf-cell-input" type="number" step="'+step+'" value="'+(st[name]??0)+'" onchange="App.setProfitInput('+cab+',\''+esc(art)+'\',\''+name+'\',this.value)">';
  const sort=SORT[cab]||{key:"sum",dir:-1};
  const sortValue=x=>({art:x.r.art,qty:x.r.qty,buyout:x.st.buyout,price:x.st.price,disc:x.st.disc,spp:x.st.spp,site:x.z.site,hold:x.z.commRub+x.z.acquiring+x.z.wallet,logistics:x.z.logistics,prep:x.z.prep,cogs:x.st.cogs,store:x.z.store,tax:x.z.tax,vat:x.z.vat,fixed:x.st.fixed,ads:x.z.cps,profit:x.z.profit,profitSum:x.profitSum,margin:x.z.margin,sum:x.r.sum}[sort.key]);
  records.sort((a,b)=>{const x=sortValue(a),y=sortValue(b);return typeof x==="string"?x.localeCompare(y,"ru")*sort.dir:(n(x)-n(y))*sort.dir;});
  const body=records.map(({r,st,z,buySum,profitSum})=>{
    const color=profitSum>=0?"var(--green)":"var(--red)";
    return '<tr class="pf-main-row">'+
    '<td><button class="pf-art-settings" title="Настроить рекламу и расчёт для артикула" onclick="App.toggleProfit('+cab+',\''+esc(r.art)+'\')">Настр.</button> <b>'+esc(r.art)+'</b></td>'+
      '<td>'+r.qty+'</td><td>'+cellInput(cab,r.art,st,"buyout","0.1")+'</td>'+
      '<td>'+cellInput(cab,r.art,st,"price","1")+'</td><td>'+cellInput(cab,r.art,st,"disc","0.1")+'</td><td>'+cellInput(cab,r.art,st,"spp","0.1")+'</td>'+
      '<td>'+money(z.site)+'</td><td>'+money(z.commRub+z.acquiring+z.wallet)+'</td><td>'+money(z.logistics)+'</td><td>'+money(z.prep)+'</td>'+
      '<td>'+cellInput(cab,r.art,st,"cogs","1")+'</td><td>'+money(z.store)+'</td><td>'+money(z.tax)+'</td><td>'+money(z.vat)+'</td>'+
      '<td>'+money(st.fixed)+'</td><td><label class="pf-ad-control" title="Учитывать теоретическую рекламу в прибыли"><input type="checkbox" '+(st.ad_enabled?'checked':'')+' onchange="App.setProfitInput('+cab+',\''+esc(r.art)+'\',\'ad_enabled\',this.checked?1:0)"><span>'+(st.ad_enabled?money(z.cps):'выкл.')+'</span></label></td>'+
      '<td>'+money(z.profit)+'</td><td style="color:'+color+';font-weight:700">'+money(profitSum)+'</td><td>'+pct(z.margin)+'</td>'+
      '</tr>'+(opened()[keyOf(cab,r.art)]?detail(cab,r,st,z):"");
  }).join("");
  const qty=records.reduce((s,x)=>s+x.r.qty,0),sum=records.reduce((s,x)=>s+x.r.sum,0),buy=records.reduce((s,x)=>s+x.buySum,0),profit=records.reduce((s,x)=>s+x.profitSum,0);
  const period=(CM[cab]||"day")==="month"?"30 дней":(CM[cab]||"day")==="week"?"7 дней":(CM[cab]||"day")==="yesterday"?"вчера":"сегодня";
  return '<div class="sec" id="profitability'+cab+'"><style>'+
    '#profitability'+cab+' .tw{width:100%;max-width:100%;overflow:hidden}'+
    '#profitability'+cab+' table{width:100%!important;min-width:0!important;max-width:100%;table-layout:fixed;border-collapse:collapse;font-size:10px}'+
    '#profitability'+cab+' th{cursor:pointer}#profitability'+cab+' th{padding:5px 3px;white-space:normal;overflow-wrap:anywhere;line-height:1.15;text-align:right;font-size:9px}#profitability'+cab+' td{padding:5px 3px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;text-align:right}#profitability'+cab+' th:first-child,#profitability'+cab+' td:first-child{text-align:left}'+
    '#profitability'+cab+' th:nth-child(1),#profitability'+cab+' td:nth-child(1){width:12%}'+
    '#profitability'+cab+' th:nth-child(2),#profitability'+cab+' td:nth-child(2){width:4%}'+
    '#profitability'+cab+' th:nth-child(3),#profitability'+cab+' td:nth-child(3){width:4%}'+
    '#profitability'+cab+' th:nth-child(4),#profitability'+cab+' td:nth-child(4){width:6%}'+
    '#profitability'+cab+' th:nth-child(5),#profitability'+cab+' td:nth-child(5){width:4%}'+
    '#profitability'+cab+' th:nth-child(6),#profitability'+cab+' td:nth-child(6){width:4%}'+
    '#profitability'+cab+' th:nth-child(7),#profitability'+cab+' td:nth-child(7){width:6%}'+
    '#profitability'+cab+' th:nth-child(8),#profitability'+cab+' td:nth-child(8){width:6%}'+
    '#profitability'+cab+' th:nth-child(9),#profitability'+cab+' td:nth-child(9){width:5%}'+
    '#profitability'+cab+' th:nth-child(10),#profitability'+cab+' td:nth-child(10){width:4%}'+
    '#profitability'+cab+' th:nth-child(11),#profitability'+cab+' td:nth-child(11){width:5%}'+
    '#profitability'+cab+' th:nth-child(12),#profitability'+cab+' td:nth-child(12){width:4%}'+
    '#profitability'+cab+' th:nth-child(13),#profitability'+cab+' td:nth-child(13){width:4%}'+
    '#profitability'+cab+' th:nth-child(14),#profitability'+cab+' td:nth-child(14){width:4%}'+
    '#profitability'+cab+' th:nth-child(15),#profitability'+cab+' td:nth-child(15){width:4%}'+
    '#profitability'+cab+' th:nth-child(16),#profitability'+cab+' td:nth-child(16){width:7%}'+
    '#profitability'+cab+' th:nth-child(17),#profitability'+cab+' td:nth-child(17){width:6%}'+
    '#profitability'+cab+' th:nth-child(18),#profitability'+cab+' td:nth-child(18){width:7%}'+
    '#profitability'+cab+' th:nth-child(19),#profitability'+cab+' td:nth-child(19){width:4%}'+
    '#profitability'+cab+' .pf-cell-input{width:100%;max-width:54px;box-sizing:border-box;padding:3px 3px;border:1px solid var(--border2);border-radius:5px;background:#fff;color:var(--ink);font:inherit;font-size:10px;text-align:right}'+
    '#profitability'+cab+' .pf-art-settings{border:0;border-radius:4px;background:var(--bg3);color:var(--ink2);padding:3px 4px;font:inherit;font-size:9px;cursor:pointer}'+
    '#profitability'+cab+' .pf-ad-control{display:flex;align-items:center;justify-content:flex-end;gap:3px;font-variant-numeric:tabular-nums}#profitability'+cab+' .pf-ad-control input{width:12px;height:12px;margin:0;accent-color:var(--green);cursor:pointer}'+
    '#profitability'+cab+' .pf-settings-btn{margin-top:5px;border:1px solid var(--border2);background:#fff;border-radius:5px;padding:3px 7px;font:inherit;font-size:10px;cursor:pointer}'+
    '#profitability'+cab+' .pf-settings-row>td{padding:8px!important;background:#f8f6f1}'+
    '#profitability'+cab+' .pf-settings-row details>summary{cursor:pointer;font-size:11px;color:var(--ink2);padding:4px 0}'+
    '#profitability'+cab+' .pf-note-inline{color:var(--ink3);margin-left:8px}'+
    '#profitability'+cab+' .pf-edit-grid{display:grid;grid-template-columns:repeat(6,minmax(120px,1fr));gap:8px;padding:10px 0}'+
    '#profitability'+cab+' .pf-field{display:block;font-size:10px;color:var(--ink2)}'+
    '#profitability'+cab+' .pf-field span{display:block;margin-bottom:3px}'+
    '#profitability'+cab+' .pf-field input{width:100%;box-sizing:border-box;border:1px solid var(--border2);border-radius:5px;background:white;padding:6px 7px;font:inherit;font-size:12px;color:var(--ink)}'+
    '#profitability'+cab+' .pf-note{font-size:10px;color:var(--ink3);line-height:1.5}'+
    '#profitability'+cab+' .pf-table-toggle{border:1px solid var(--border2);border-radius:6px;background:var(--bg3);padding:4px 8px;color:var(--ink2);font:inherit;font-size:10px;cursor:pointer}'+
    '</style><div class="sh"><span class="st">Прибыльность заказов · WB</span><span class="sm2">'+period+' · '+qty+' шт. · FBW + FBS</span><button class="pf-table-toggle" onclick="App.toggleProfitTable('+cab+')">'+(TABLE_HIDDEN[cab]?"Показать таблицу":"Скрыть таблицу")+'</button></div>'+
    (TABLE_HIDDEN[cab]?"":'<div class="sm2" style="margin:4px 0 8px">Реклама учитывается только у отмеченных артикулов. Ставка за 1000 показов, CTR и CR настраиваются кнопкой «Настр.» в строке артикула. СПП по умолчанию 31%, можно изменить прямо в таблице.</div>'+
    '<div class="tw"><table><thead><tr><th onclick="App.sortProfit('+cab+',&#39;art&#39;)">Артикул</th><th onclick="App.sortProfit('+cab+',&#39;qty&#39;)">Заказы</th><th onclick="App.sortProfit('+cab+',&#39;buyout&#39;)">Выкуп %</th><th onclick="App.sortProfit('+cab+',&#39;price&#39;)">Цена</th><th onclick="App.sortProfit('+cab+',&#39;disc&#39;)">Скидка %</th><th onclick="App.sortProfit('+cab+',&#39;spp&#39;)">СПП %</th><th onclick="App.sortProfit('+cab+',&#39;site&#39;)">На сайте</th><th onclick="App.sortProfit('+cab+',&#39;hold&#39;)">Удержания WB</th><th onclick="App.sortProfit('+cab+',&#39;logistics&#39;)">Логистика</th><th onclick="App.sortProfit('+cab+',&#39;prep&#39;)">Приёмка</th><th onclick="App.sortProfit('+cab+',&#39;cogs&#39;)">Себест.</th><th onclick="App.sortProfit('+cab+',&#39;store&#39;)">Хранение</th><th onclick="App.sortProfit('+cab+',&#39;tax&#39;)">Налог</th><th onclick="App.sortProfit('+cab+',&#39;vat&#39;)">НДС</th><th onclick="App.sortProfit('+cab+',&#39;fixed&#39;)">Постоянные</th><th onclick="App.sortProfit('+cab+',&#39;ads&#39;)">Реклама</th><th onclick="App.sortProfit('+cab+',&#39;profit&#39;)">Прибыль/шт.</th><th onclick="App.sortProfit('+cab+',&#39;profitSum&#39;)">Прибыль всего</th><th onclick="App.sortProfit('+cab+',&#39;margin&#39;)">Маржа</th></tr></thead><tbody>'+
    (body||'<tr><td colspan="19" class="em">Нет заказов WB за выбранный период</td></tr>')+
    '<tr style="border-top:2px solid var(--border2);font-weight:700"><td>Итого</td><td>'+qty+'</td><td colspan="4">—</td><td>—</td><td>—</td><td>—</td><td>—</td><td>—</td><td>—</td><td>—</td><td>—</td><td>—</td><td>—</td><td>—</td><td style="text-align:right;color:'+(profit>=0?"var(--green)":"var(--red)")+'">'+money(profit)+'</td><td>—</td></tr></tbody></table></div>')+'</div>';
}
export function toggleProfitTable(cab){TABLE_HIDDEN[cab]=!TABLE_HIDDEN[cab];}
export function sortProfit(cab,key){const cur=SORT[cab]||{key:"sum",dir:-1};SORT[cab]={key,dir:cur.key===key?-cur.dir:(key==="art"?1:-1)};const vm=LAST_VM[cab];if(vm)repaintProfitability(cab,vm);}
export function repaintProfitability(cab,vm){const el=document.getElementById("profitability"+cab);if(el&&vm)el.outerHTML=profitabilityHTML(cab,vm);}
export function setProfitInput(cab,art,field,value){input(cab,art,field,value);}
export function toggleProfit(cab,art){toggle(cab,art);}


