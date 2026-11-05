import fs from "node:fs/promises";
import { chromium } from "playwright-core";

const html=(await fs.readFile("index.html","utf8"))
  .replace(/<script[^>]*>[\\s\\S]*?<\\/script>/gi,"")
  .replace(/<link[^>]*rel="stylesheet"[^>]*>/gi,"");
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
} finally {await browser.close();}
