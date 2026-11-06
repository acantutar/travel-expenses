import fs from "node:fs/promises";
import assert from "node:assert/strict";
import { chromium } from "playwright-core";

const html=(await fs.readFile("index.html","utf8"))
  .replace(new RegExp("<script[^>]*>.*?</script>","gis"),"")
  .replace(new RegExp("<link[^>]*rel=.stylesheet.[^>]*>","gi"),"");
const js=await fs.readFile("app.js","utf8");
const browser=await chromium.launch({channel:"chrome",headless:true,args:["--no-sandbox"]});

async function setup(guestEnabled) {
  const page=await browser.newPage({viewport:{width:375,height:900}});
  const errors=[];
  page.on("pageerror",err=>errors.push(err.message));
  await page.setContent(html,{waitUntil:"domcontentloaded"});
  await page.evaluate(({enabled})=>{
    const userId="33333333-3333-4333-8333-333333333333";
    const tripId="44444444-4444-4444-8444-444444444444";
    const guest={id:userId,is_anonymous:true};
    const profile={id:userId,username:"Misafir",
      login_name:"guest.33333333333343338333333333333333",
      is_admin:false,is_active:true};
    const fixture={
      currency_catalog:[{code:"TL",name_tr:"Türk lirası"},{code:"EUR",name_tr:"Euro"}],
      user_currency_favorites:[],
      trips:[],trip_members:[],profiles:[profile],expense_versions:[],
      settlement_versions:[],trip_display_rates:[]
    };
    window.__guestTest={signInCalls:0,tripCalls:[],fixture};
    window.APP_CONFIG={SUPABASE_URL:"https://example.supabase.co",
      SUPABASE_PUBLISHABLE_KEY:"test_publishable_key", ENABLE_GUEST_SIGNIN:enabled};
    const from=(table)=>{
      const builder={
        select(){return builder;},order(){return builder;},eq(){return builder;},
        limit(){return builder;},
        single(){return Promise.resolve({data:(fixture[table]||[])[0]||null,error:null});},
        maybeSingle(){return Promise.resolve({data:(fixture[table]||[])[0]||null,error:null});},
        then(resolve,reject){return Promise.resolve({data:fixture[table]||[],error:null}).then(resolve,reject);}
      };
      return builder;
    };
    window.supabase={createClient(){return{
      from,
      rpc:async(name,p)=>{
        if(name==="create_trip_with_settings"){
          window.__guestTest.tripCalls.push(p);
          fixture.trips.push({id:tripId,name:p.p_name,destination:p.p_destination,
            starts_on:p.p_starts_on,ends_on:p.p_ends_on,owner_id:userId,
            base_currency:p.p_base_currency,allowed_currencies:p.p_currencies,
            created_at:new Date().toISOString()});
          fixture.trip_members.push({trip_id:tripId,user_id:userId,
            role:"owner",is_active:true,joined_at:new Date().toISOString()});
          return {data:tripId,error:null};
        }
        return {data:[],error:null};
      },
      auth:{
        getSession:async()=>({data:{session:null},error:null}),
        signInAnonymously:async()=>{
          window.__guestTest.signInCalls++;
          return {data:{user:guest,session:{user:guest}},error:null};
        },
        signOut:async()=>({error:null}),
        onAuthStateChange:()=>({data:{subscription:{unsubscribe(){}}}})
      }
    };}};
  },{enabled:guestEnabled});
  await page.addScriptTag({content:js});
  await page.waitForFunction(()=>!document.getElementById("authScreen").classList.contains("hidden"));
  return {page,errors};
}
try {
  {
    const {page,errors}=await setup(false);
    const visible=await page.locator("#guestStartBox").evaluate(el=>!el.classList.contains("hidden"));
    assert.equal(visible,false,"guest entry must stay hidden while disabled");
    assert.deepEqual(errors,[]);
    await page.close();
    console.log("PASS: disabled guest sign-in does not advertise unfinished feature");
  }
  {
    const {page,errors}=await setup(true);
    await page.locator("#guestStartBox:not(.hidden)").waitFor();
    await page.click("#startGuestBtn");
    await page.locator("#tripCreateModal:not(.hidden)").waitFor();
    const state=await page.evaluate(()=>({
      signInCalls:window.__guestTest.signInCalls,
      appVisible:!document.getElementById("appScreen").classList.contains("hidden"),
      noticeVisible:!document.getElementById("guestSessionNotice").classList.contains("hidden"),
      passwordHidden:document.getElementById("passwordPanel").classList.contains("hidden"),
      modalVisible:!document.getElementById("tripCreateModal").classList.contains("hidden"),
      advancedClosed:!document.getElementById("newTripAdvanced").open,
      base:document.getElementById("newTripBaseCurrency").value,
      selected:[...document.querySelectorAll("#newTripCurrencyChoices input:checked")].map(x=>x.value),
      focus:document.activeElement?.id
    }));
    assert.deepEqual(state,{
      signInCalls:1,appVisible:true,noticeVisible:true,passwordHidden:true,
      modalVisible:true,advancedClosed:true,base:"TL",selected:["TL"],focus:"newTripName"
    });
    await page.fill("#newTripName","Kapadokya tatili");
    await page.click("#saveNewTripBtn");
    await page.waitForFunction(()=>window.__guestTest.tripCalls.length===1);
    await page.locator("#tripCreateModal.hidden").waitFor();
    const result=await page.evaluate(()=>({
      call:window.__guestTest.tripCalls[0],
      trip:document.getElementById("tripSelect").selectedOptions[0]?.textContent,
      noticeVisible:!document.getElementById("guestSessionNotice").classList.contains("hidden")
    }));
    assert.equal(result.call.p_name,"Kapadokya tatili");
    assert.equal(result.call.p_base_currency,"TL");
    assert.deepEqual(result.call.p_currencies,["TL"]);
    assert.equal(result.trip,"Kapadokya tatili");
    assert.equal(result.noticeVisible,true);
    assert.deepEqual(errors,[]);
    console.log("PASS: anonymous guest creates private TL trip without registering a username");
    await page.close();
  }
} finally {
  await browser.close();
}
