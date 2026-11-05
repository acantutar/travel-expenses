import fs from "node:fs/promises";
import { chromium } from "playwright-core";

const html=(await fs.readFile("index.html","utf8"))
  .replace(new RegExp("<script[^>]*>.*?</script>","gis"),"")
  .replace(new RegExp("<link[^>]*rel=.stylesheet.[^>]*>","gi"),"");
const js=await fs.readFile("app.js","utf8");
const browser=await chromium.launch({channel:"chrome",headless:true,args:["--no-sandbox"]});
try {
  const page=await browser.newPage({viewport:{width:375,height:900}});
  const errors=[];
  page.on("pageerror",err=>errors.push(err.message));
  await page.setContent(html,{waitUntil:"domcontentloaded"});
  await page.evaluate(()=>{
    window.APP_CONFIG={
      SUPABASE_URL:"https://example.supabase.co",
      SUPABASE_PUBLISHABLE_KEY:"test_publishable_key"
    };
    window.supabase={
      createClient(){
        return {
          from(table){
            if(table!=="currency_catalog")throw new Error("Unexpected initial table: "+table);
            return {
              select(){return {order:async()=>({data:[
                {code:"TL",name_tr:"Türk lirası"},{code:"EUR",name_tr:"Euro"},
                {code:"USD",name_tr:"ABD doları"},{code:"GEL",name_tr:"Gürcistan larisi"}
              ],error:null})};}
            };
          },
          rpc:async()=>({data:[],error:null}),
          auth:{
            getSession:async()=>({data:{session:null},error:null}),
            onAuthStateChange:()=>({data:{subscription:{unsubscribe(){}}}})
          }
        };
      }
    };
  });
  await page.addScriptTag({content:js});
  await page.waitForFunction(()=>!document.getElementById("authScreen").classList.contains("hidden"),{timeout:10000});
  const result=await page.evaluate(()=>({
    loginVisible:!document.getElementById("authScreen").classList.contains("hidden"),
    defaultCurrencies:[...document.querySelectorAll("#newTripCurrencyChoices .currency-picker-options input")].map(e=>e.value),
    currencyCount:document.getElementById("newTripCurrencyChoices").querySelectorAll("input[type=checkbox]").length,
    baseCurrency:document.getElementById("newTripBaseCurrency").value,
    modalButton:!!document.getElementById("newTripBtn")
  }));
  if(errors.length || !result.loginVisible || !result.baseCurrency || result.currencyCount===0) {
    throw new Error("STARTUP FAILED: "+JSON.stringify({result,errors}));
  }
  console.log("PASS actual app startup with mocked unsigned session: "+JSON.stringify(result));
  await page.close();

  // Reproduce a returning user with a saved Auth session without using real credentials.
  const signedIn=await browser.newPage({viewport:{width:375,height:900}});
  const signedErrors=[];
  signedIn.on("pageerror",err=>signedErrors.push(err.message));
  await signedIn.setContent(html,{waitUntil:"domcontentloaded"});
  await signedIn.evaluate(()=>{
    const uid="11111111-1111-4111-8111-111111111111";
    const tripId="22222222-2222-4222-8222-222222222222";
    const profile={id:uid,username:"Test Kullanıcısı",login_name:"test",
      is_admin:false,is_active:true,created_at:new Date().toISOString()};
    const trip={id:tripId,name:"Deneme Gezisi",destination:"İstanbul",
      starts_on:"2026-11-02",ends_on:"2026-11-09",owner_id:uid,
      base_currency:"TL",allowed_currencies:["TL","EUR","USD"],created_at:new Date().toISOString()};
    const fixtures={
      currency_catalog:[{code:"TL",name_tr:"Türk lirası"},{code:"EUR",name_tr:"Euro"},
        {code:"USD",name_tr:"ABD doları"},{code:"MYR",name_tr:"Ringgit"}],
      user_currency_favorites:[],
      trips:[trip],
      trip_members:[{trip_id:tripId,user_id:uid,role:"owner",is_active:true,joined_at:new Date().toISOString()}],
      profiles:[profile],expense_versions:[],settlement_versions:[],trip_display_rates:[]
    };
    const query=(table)=>{
      const response=()=>({data:fixtures[table]||[],error:null});
      const builder={
        select(){return builder;},order(){return builder;},eq(){return builder;},
        limit(){return builder;},maybeSingle(){return Promise.resolve({data:fixtures[table]?.[0]||null,error:null});},
        single(){return Promise.resolve({data:fixtures[table]?.[0]||null,error:null});},
        then(onOk,onErr){return Promise.resolve(response()).then(onOk,onErr);}
      };
      return builder;
    };
    window.APP_CONFIG={
      SUPABASE_URL:"https://example.supabase.co",
      SUPABASE_PUBLISHABLE_KEY:"test_publishable_key"
    };
    window.supabase={createClient(){return{
      from:query,
      rpc:async(name,params)=>{ window.__tripRpcCalls=(window.__tripRpcCalls||[]).concat([{name,params}]); return {data:name==="list_trip_invites"?[]:name==="create_trip_with_settings"?tripId:null,error:null}; },
      auth:{
        getSession:async()=>({data:{session:{user:{id:uid}}},error:null}),
        onAuthStateChange:()=>({data:{subscription:{unsubscribe(){}}}})
      }
    };}};
  });
  await signedIn.addScriptTag({content:js});
  await signedIn.waitForFunction(()=>!document.getElementById("appScreen").classList.contains("hidden"),
    null,{timeout:10000});
  await signedIn.waitForFunction(()=>document.getElementById("tripSelect").options.length>0,
    null,{timeout:10000});
  const signedResult=await signedIn.evaluate(()=>({
    appVisible:!document.getElementById("appScreen").classList.contains("hidden"),
    accountName:document.getElementById("accountUsername").textContent,
    tripName:document.getElementById("tripSelect").selectedOptions[0]?.textContent,
    page:document.querySelector(".page.active")?.id,
    defaultCurrencies:document.querySelectorAll("#newTripCurrencyChoices .currency-picker-options input").length
  }));
  if(signedErrors.length || !signedResult.appVisible || signedResult.tripName!=="Deneme Gezisi") {
    throw new Error("SIGNED-IN BOOT FAILED: "+JSON.stringify({signedResult,signedErrors}));
  }
  console.log("PASS signed-in app startup with mock database: "+JSON.stringify(signedResult));

  // The quick-start modal asks for a trip name only; optional settings stay hidden.
  await signedIn.click("#newTripBtn");
  const quickStart=await signedIn.evaluate(()=>{
    const advanced=document.getElementById("newTripAdvanced");
    const currencies=[...document.querySelectorAll("#newTripCurrencyChoices input[type=checkbox]:checked")]
      .map(node=>node.value);
    return {
      modalVisible:!document.getElementById("tripCreateModal").classList.contains("hidden"),
      advancedClosed:!advanced.open,
      destinationHidden:document.getElementById("newTripDestination").closest("details")?.open === false,
      base:document.getElementById("newTripBaseCurrency").value,
      selected:currencies,
      focused:document.activeElement?.id
    };
  });
  if(!quickStart.modalVisible || !quickStart.advancedClosed || !quickStart.destinationHidden
      || quickStart.base!=="TL" || JSON.stringify(quickStart.selected)!=='["TL"]'
      || quickStart.focused!=="newTripName"){
    throw new Error("QUICK TRIP DEFAULTS FAILED: "+JSON.stringify({quickStart,signedErrors}));
  }
  await signedIn.fill("#newTripName","Hafta sonu gezisi");
  await signedIn.click("#saveNewTripBtn");
  await signedIn.waitForFunction(()=>Boolean(window.__tripRpcCalls?.some(c=>c.name==="create_trip_with_settings")),
    null,{timeout:10000});
  const createCall=await signedIn.evaluate(()=>window.__tripRpcCalls.find(c=>c.name==="create_trip_with_settings"));
  if(createCall.params.p_name!=="Hafta sonu gezisi" ||
     createCall.params.p_base_currency!=="TL" ||
     JSON.stringify(createCall.params.p_currencies)!=='["TL"]' ||
     createCall.params.p_destination!==""){
    throw new Error("QUICK TRIP RPC FAILED: "+JSON.stringify({createCall,signedErrors}));
  }
  console.log("PASS one-field trip create calls real RPC with TL defaults: "+JSON.stringify(createCall.params));
  await signedIn.close();
} finally {await browser.close();}
