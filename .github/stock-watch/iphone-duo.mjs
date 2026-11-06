// Apple The Exchange TRX — iPhone Duo 512 GB Night Sky pickup monitor.
// Uses GitHub's ephemeral GITHUB_TOKEN. No personal API keys are needed.
// Apple pickup-message is undocumented and may change.
const TITLE='🚨 iPhone Duo 512 GB Night Sky — Apple TRX STOK GELDİ';
const PRODUCT='https://www.apple.com/my/shop/buy-iphone/iphone-duo/7.6-inch-display-512gb-night-sky';
const CATALOG='https://www.apple.com/my/shop/buy-iphone/iphone-duo';
const DEFAULT_SKU='MK2G4X/A'; // MY retail SKU for exact colour/capacity.
const OWNER='acantutar';
const UA='Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/125 Safari/537.36';
async function http(url, options={}){
  const r=await fetch(url,{...options,signal:AbortSignal.timeout(18000)});
  if(!r.ok) throw new Error('HTTP '+r.status+' '+new URL(url).pathname);
  return r;
}
async function appleStock(){
  let sku=DEFAULT_SKU;
  try {
    const html=await (await http(CATALOG,{headers:{'User-Agent':UA}})).text();
    const rx=/"partNumber":"([^"]+)","price":\{"fullPrice":[^}]+\},"category":"iphone","name":"([^"]+)"/g;
    for(const m of html.matchAll(rx)){
      const name=m[2].replace(/\s+/g,' ').trim();
      if(/^iPhone Duo 512GB Night Sky$/i.test(name)){sku=m[1];break;}
    }
  }catch(e){console.warn('Using known Malaysia SKU; catalog error:',e.message);}
  const qs=new URLSearchParams({'pl':'true','mts.0':'regular','parts.0':sku,'location':'55188'});
  const url='https://www.apple.com/my/shop/retail/pickup-message?'+qs;
  const data=await (await http(url,{headers:{'User-Agent':UA,'Accept':'application/json','Referer':CATALOG}})).json();
  const stores=data?.body?.stores;
  if(!Array.isArray(stores)) throw new Error('Apple did not return stores');
  const trx=stores.find(s=>/exchange\s*trx/i.test(s.storeName||''));
  if(!trx) throw new Error('The Exchange TRX missing in pickup result');
  const part=trx.partsAvailability?.[sku];
  if(!part?.pickupDisplay) throw new Error('Apple did not return pickup status for '+sku);
  return {available:part.pickupDisplay==='available',status:part.pickupDisplay,
    store:trx.storeName,sku,link:(trx.makeReservationUrl||trx.reservationUrl||PRODUCT).replace(/^http:/,'https:')};
}
async function gh(method,path,data){
  const url='https://api.github.com/repos/'+process.env.GITHUB_REPOSITORY+path;
  const r=await http(url,{
    method,
    headers:{'Authorization':'Bearer '+process.env.GITHUB_TOKEN,'Accept':'application/vnd.github+json',
      'X-GitHub-Api-Version':'2022-11-28','Content-Type':'application/json','User-Agent':'iphone-duo-watch'},
    ...(data?{body:JSON.stringify(data)}:{})
  });
  return r.json();
}
async function run(){
  if(!process.env.GITHUB_TOKEN||!process.env.GITHUB_REPOSITORY) throw new Error('Missing GitHub Actions token');
  const result=await appleStock();
  console.log('Apple',result.store,result.sku,result.status);
  const issues=await gh('GET','/issues?state=open&per_page=100');
  const current=issues.find(i=>i.title===TITLE&&!i.pull_request);
  if(result.available&&!current){
    const when=new Intl.DateTimeFormat('tr-TR',{timeZone:'Asia/Kuala_Lumpur',dateStyle:'medium',timeStyle:'medium'}).format(new Date());
    const body=[
      '## 🚨 STOK GELDİ — HEMEN KONTROL ET','',
      '**iPhone Duo 512 GB Night Sky**','**Apple The Exchange TRX — Kuala Lumpur**','',
      '**Kontrol saati (Malezya):** '+when,
      '**Apple satın alma:** '+PRODUCT,
      '**Mağazadan teslim:** '+result.link,'',
      'Hemen Apple sitesine girip stok ve ödeme adımını doğrula. Bu bot otomatik satın alma yapmaz.','',
      '@'+OWNER+' — stok bulundu.','',
      '_Stok biterse bu uyarı otomatik kapatılır._'
    ].join('\n');
    const issue=await gh('POST','/issues',{title:TITLE,body,assignees:[OWNER]});
    console.log('STOCK ALERT CREATED:',issue.html_url);
  }else if(!result.available&&current){
    await gh('PATCH','/issues/'+current.number,{state:'closed',state_reason:'completed'});
    console.log('No longer available; previous stock alert closed');
  }else{
    console.log(result.available?'Already alerted':'Sold out; no alert');
  }
}
run().catch(e=>{console.error('CHECK FAILED:',e.message);process.exitCode=1;});
