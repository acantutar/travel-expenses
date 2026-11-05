import fs from "node:fs/promises";
import path from "node:path";
import { chromium } from "playwright-core";

const root=process.cwd();
const raw=await fs.readFile(path.join(root,"index.html"),"utf8");
const css=await fs.readFile(path.join(root,"styles.css"),"utf8");
// This is a CSS/layout smoke test; authentication and browser-side application data are mocked.
const html=raw.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi,"")
  .replace(/<link\b[^>]*rel="stylesheet"[^>]*>/gi,"");
const browser=await chromium.launch({channel:"chrome",headless:true,args:["--no-sandbox"]});
let errors=0;
for(const width of [375,768,1440]){
  for(const mode of ["account","newtrip"]){
    const page=await browser.newPage({viewport:{width,height:900},deviceScaleFactor:1});
    await page.setContent(html,{waitUntil:"domcontentloaded"});
    await page.addStyleTag({content:css});
    const result=await page.evaluate((mode)=>{
      document.getElementById("authScreen").classList.add("hidden");
      const app=document.getElementById("appScreen");
      app.classList.remove("hidden");
      app.classList.remove("entry-mode");
      document.getElementById("setupScreen").classList.add("hidden");
      document.getElementById("page-add").classList.remove("active");
      document.getElementById("page-account").classList.add("active");
      document.getElementById("tripSelect").innerHTML='<option>Vietnam ve Malezya</option>';
      document.getElementById("userChip").textContent="ACT";
      document.getElementById("tripDateRange").textContent="12.09.2026 – 28.09.2026";
      document.getElementById("tripMembersPanel").classList.remove("hidden");
      document.getElementById("tripRatePanel").classList.remove("hidden");
      document.getElementById("accountUsername").textContent="ACT";
      document.getElementById("accountTripCount").textContent="2";
      for(const id of ["newTripCurrencyChoices","tripAllowedCurrencyChoices"]){
        const node=document.getElementById(id);
        node.innerHTML='<div class="currency-picker-heading"><strong>Önerilen 10 para birimi</strong><span class="currency-picked-count">3 seçili</span></div>'
          +'<div class="currency-picker-options">'
          +["TRY","EUR","USD","GBP","AED","SAR","GEL","THB","MYR","JPY"].map((c,i)=>
            '<label class="currency-check"><input type="checkbox" '+(i<3?"checked":"")+'><span>'+c+'</span></label>').join("")
          +'</div><button class="currency-more-toggle" type="button">+ Diğer para birimlerini ekle</button>';
      }
      if(mode==="newtrip"){
        document.getElementById("tripCreateModal").classList.remove("hidden");
        document.getElementById("newTripName").value="Gürcistan Gezisi";
      }
      const rect=(id)=>document.getElementById(id).getBoundingClientRect();
      const headerIds=["tripSelect","newTripBtn","userChip"];
      const header=headerIds.map(rect);
      const intersects=(a,b)=>{
        const dx=Math.min(a.right,b.right)-Math.max(a.left,b.left);
        const dy=Math.min(a.bottom,b.bottom)-Math.max(a.top,b.top);
        return dx>3&&dy>3;
      };
      const overlaps=[];
      for(let i=0;i<header.length;i++)for(let j=i+1;j<header.length;j++)
        if(intersects(header[i],header[j]))overlaps.push(headerIds[i]+" × "+headerIds[j]);
      const nodes=[...document.querySelectorAll("#appScreen input,#appScreen select,#appScreen button,#tripCreateModal input,#tripCreateModal select,#tripCreateModal button")]
        .filter(n=>{const c=getComputedStyle(n);return c.display!=="none"&&c.visibility!=="hidden"});
      const outOfBounds=nodes.filter(n=>{
        const r=n.getBoundingClientRect();
        return r.width>0 && (r.left< -3 || r.right>innerWidth+3);
      }).slice(0,8).map(n=>n.id||n.className);
      const modal=rect("tripCreateModal");
      const modalPanel=document.querySelector("#tripCreateModal .modal").getBoundingClientRect();
      const modalBad=mode==="newtrip" && (modalPanel.right>innerWidth+2||modalPanel.left< -2||
        modalPanel.bottom>innerHeight+2||modalPanel.top< -2);
      const bodyOverflow=document.documentElement.scrollWidth>innerWidth+3;
      return {width:innerWidth,height:innerHeight,mode,bodyOverflow,overlaps,outOfBounds,modalBad,modalW:Math.round(modalPanel.width)};
    },mode);
    const ok=!result.bodyOverflow&&!result.overlaps.length&&!result.outOfBounds.length&&!result.modalBad;
    console.log((ok?"PASS":"FAIL")+" "+JSON.stringify(result));
    if(!ok)errors++;
    if(process.env.UI_SCREENSHOTS==="1"){
      await fs.mkdir(path.join(root,"ui-screenshots"),{recursive:true});
      await page.screenshot({path:path.join(root,"ui-screenshots",mode+"-"+width+".png"),fullPage:false});
    }
    await page.close();
  }
}
await browser.close();
if(errors)process.exit(1);
