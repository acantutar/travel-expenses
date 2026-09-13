(() => {
  "use strict";
  const cfg = window.APP_CONFIG || {};
  const isConfigured = cfg.SUPABASE_URL && cfg.SUPABASE_PUBLISHABLE_KEY;
  const $ = (id) => document.getElementById(id);
  let client, currentUser, currentProfile;
  let allProfiles = [], allVersions = [], currentExpenses = [];
  let authMode = "login";

  const CURRENCIES = ["MYR","VND","USD","TL"];
  const DECIMALS = { VND: 0, MYR: 2, USD: 2, TL: 2 };

  function setScreen(name){["setup","auth","app"].forEach(n=>$(n+"Screen").classList.toggle("hidden",n!==name));}
  function updateOnlineState(){$("offlineBanner").classList.toggle("hidden",navigator.onLine);}
  function showMessage(el,type,text){el.className=`message ${type}`;el.textContent=text;el.classList.remove("hidden");}
  function clearMessage(el){el.className="message hidden";el.textContent="";}
  let toastTimer; function showToast(text){$("toast").textContent=text;$("toast").classList.remove("hidden");clearTimeout(toastTimer);toastTimer=setTimeout(()=>$("toast").classList.add("hidden"),2600);}
  function escapeHtml(v){return String(v??"").replaceAll("&","&amp;").replaceAll("<","&lt;").replaceAll(">","&gt;").replaceAll('"',"&quot;").replaceAll("'","&#039;");}
  function normalizeUsername(v){return v.trim().toLowerCase().replace(/\s+/g,"");}
  function usernameToEmail(u){return `${u}@travel-expenses.app`;}
  function usernameIsValid(u){return /^[a-z0-9._-]{2,30}$/.test(u);}
  function profileName(id){return allProfiles.find(p=>p.id===id)?.username||"Bilinmiyor";}
  function formatAmount(v,c){return new Intl.NumberFormat("tr-TR",{minimumFractionDigits:DECIMALS[c]??2,maximumFractionDigits:DECIMALS[c]??2}).format(Number(v||0));}
  function formatDate(v){return new Intl.DateTimeFormat("tr-TR",{day:"2-digit",month:"2-digit",year:"numeric",hour:"2-digit",minute:"2-digit"}).format(new Date(v));}
  function isNetworkLikeError(e){const m=String(e?.message||e||"").toLowerCase();return !navigator.onLine||m.includes("fetch")||m.includes("network")||m.includes("failed to fetch");}

  function latestExpensesFromVersions(versions){
    const byId = new Map();
    versions.forEach(v=>{const prev=byId.get(v.expense_id);if(!prev||Number(v.version_no)>Number(prev.version_no))byId.set(v.expense_id,v);});
    return [...byId.values()].sort((a,b)=>new Date(b.spent_at)-new Date(a.spent_at));
  }
  function persistLocalMirror(){
    try{localStorage.setItem("travelExpensesMirrorV2",JSON.stringify({saved_at:new Date().toISOString(),profiles:allProfiles,expense_versions:allVersions}));}catch(_){ }
  }

  function setAuthMode(mode){authMode=mode;$("loginTab").classList.toggle("active",mode==="login");$("signupTab").classList.toggle("active",mode==="signup");$("confirmPasswordWrap").classList.toggle("hidden",mode!=="signup");$("confirmPassword").required=mode==="signup";$("authSubmit").textContent=mode==="login"?"Giriş Yap":"Hesap Oluştur";clearMessage($("authMessage"));}

  async function bootstrapSession(){
    if(!isConfigured){setScreen("setup");return;}
    client=window.supabase.createClient(cfg.SUPABASE_URL,cfg.SUPABASE_PUBLISHABLE_KEY,{auth:{persistSession:true,autoRefreshToken:true,detectSessionInUrl:false}});
    const {data:{session}}=await client.auth.getSession();
    if(session?.user) await enterApp(session.user); else setScreen("auth");
    client.auth.onAuthStateChange((event,sessionNow)=>{if(event==="SIGNED_OUT"||!sessionNow?.user){currentUser=null;currentProfile=null;setScreen("auth");}});
  }

  async function handleAuthSubmit(e){
    e.preventDefault();clearMessage($("authMessage"));
    if(!navigator.onLine){showMessage($("authMessage"),"warning","İnternet bağlantısı yok. Giriş/kayıt yapılamadı.");return;}
    const username=normalizeUsername($("username").value),password=$("password").value;
    if(!usernameIsValid(username)){showMessage($("authMessage"),"error","Kullanıcı adı 2-30 karakter olmalı; harf, rakam, nokta, alt çizgi ve tire kullanılabilir.");return;}
    if(password.length<6){showMessage($("authMessage"),"error","Şifre en az 6 karakter olmalı.");return;}
    if(authMode==="signup"&&password!==$("confirmPassword").value){showMessage($("authMessage"),"error","Şifreler aynı değil.");return;}
    const btn=$("authSubmit");btn.disabled=true;
    try{
      const email=usernameToEmail(username);
      if(authMode==="signup"){
        const {data,error}=await client.auth.signUp({email,password,options:{data:{username}}});if(error)throw error;
        if(!data.session){showMessage($("authMessage"),"warning","Hesap oluşturuldu fakat oturum açılamadı. Supabase'te Confirm email kapalı olmalı.");return;}
        await enterApp(data.user);showToast("Hesap oluşturuldu.");
      }else{const {data,error}=await client.auth.signInWithPassword({email,password});if(error)throw error;await enterApp(data.user);}
    }catch(err){showMessage($("authMessage"),"error",isNetworkLikeError(err)?"İşlem yapılamadı. İnternet bağlantısını kontrol et.":(authMode==="login"?"Kullanıcı adı veya şifre hatalı.":`Hesap oluşturulamadı: ${err.message}`));}
    finally{btn.disabled=false;btn.textContent=authMode==="login"?"Giriş Yap":"Hesap Oluştur";}
  }

  async function enterApp(user){
    currentUser=user;
    const {data,error}=await client.from("profiles").select("id,username,is_admin").eq("id",user.id).single();
    if(error||!data){setScreen("auth");showMessage($("authMessage"),"error","Profil alınamadı. Yeni v2 schema.sql dosyasını Supabase'te çalıştırdığından emin ol.");return;}
    currentProfile=data;$("welcomeText").textContent=`Merhaba, ${data.username}`;$("accountUsername").textContent=data.username;$("accountRole").textContent=data.is_admin?"Admin":"Kullanıcı";
    $("adminHint").classList.toggle("hidden",!data.is_admin);$("backupJsonBtn").classList.toggle("hidden",!data.is_admin);$("exportCsvBtn").classList.toggle("hidden",!data.is_admin);$("backupNote").classList.toggle("hidden",!data.is_admin);
    setScreen("app");await loadBaseData();
  }

  async function loadBaseData(){
    if(!navigator.onLine){showToast("Çevrimdışı: son yüklenen veriler ekranda kalır.");return;}
    const [pRes,vRes]=await Promise.all([
      client.from("profiles").select("id,username,is_admin,created_at").order("username"),
      client.from("expense_versions").select("*").order("created_at",{ascending:false}).limit(20000)
    ]);
    if(pRes.error) throw pRes.error;if(vRes.error) throw vRes.error;
    allProfiles=pRes.data||[];allVersions=vRes.data||[];currentExpenses=latestExpensesFromVersions(allVersions);
    persistLocalMirror();populateSelectors();renderParticipantPickers();renderRecent();renderReport();
  }

  function populateSelectors(){
    const options='<option value="">Tümü</option>'+allProfiles.map(p=>`<option value="${p.id}">${escapeHtml(p.username)}</option>`).join("");
    ["filterUser","filterParticipant"].forEach(id=>{const old=$(id).value;$(id).innerHTML=options;$(id).value=old;});
    $("editPayer").innerHTML=allProfiles.map(p=>`<option value="${p.id}">${escapeHtml(p.username)}</option>`).join("");
  }

  function participantCheckboxHtml(p,scope,checked=true){return `<label class="person-check"><input type="checkbox" data-scope="${scope}" value="${p.id}" ${checked?"checked":""}><span>${escapeHtml(p.username)}</span></label>`;}
  function renderParticipantPickers(){
    $("participantPicker").innerHTML=allProfiles.map(p=>participantCheckboxHtml(p,"add",true)).join("")||'<span class="muted">Henüz kullanıcı yok.</span>';
  }
  function selectedParticipantIds(scope){return [...document.querySelectorAll(`input[data-scope="${scope}"]:checked`)].map(x=>x.value);}

  async function saveExpense(e){
    e.preventDefault();clearMessage($("expenseMessage"));
    if(!navigator.onLine){showMessage($("expenseMessage"),"warning","İnternet bağlantısı yok. Harcama kaydedilmedi.");return;}
    const participantIds=selectedParticipantIds("add");
    if(!participantIds.length){showMessage($("expenseMessage"),"error","En az bir borca ortak kişi seçmelisin.");return;}
    const description=$("expenseDetail").value.trim(),amount=Number($("expenseAmount").value);
    if(!description||!Number.isFinite(amount)||amount<=0){showMessage($("expenseMessage"),"error","Geçerli bir detay ve tutar gir.");return;}
    const btn=$("saveExpenseBtn");btn.disabled=true;btn.textContent="Kaydediliyor…";
    try{
      const {error}=await client.rpc("create_expense",{p_description:description,p_amount:amount,p_currency:$("expenseCurrency").value,p_payment_type:$("expensePayment").value,p_participant_ids:participantIds,p_spent_at:new Date().toISOString()});
      if(error)throw error;await loadBaseData();$("expenseDetail").value="";$("expenseAmount").value="";renderParticipantPickers();showMessage($("expenseMessage"),"success","✓ Harcama kaydedildi.");
    }catch(err){showMessage($("expenseMessage"),"error",`✕ ${isNetworkLikeError(err)?"Harcama kaydedilemedi. İnternet bağlantısını kontrol edip tekrar dene.":err.message}`);}finally{btn.disabled=false;btn.textContent="Harcamayı Kaydet";}
  }

  function activeExpenses(){return currentExpenses.filter(e=>e.status==="active");}
  function renderRecent(){
    const mine=activeExpenses().filter(e=>e.payer_id===currentUser?.id).slice(0,5),el=$("recentExpenses");
    if(!mine.length){el.className="recent-list empty-state";el.textContent="Henüz kayıt yok.";return;}
    el.className="recent-list";el.innerHTML=mine.map(e=>`<div class="recent-row"><div><div class="recent-title">${escapeHtml(e.description)}</div><div class="recent-meta">${escapeHtml(e.payment_type)} · ${formatDate(e.spent_at)} · ${e.participant_ids.length} kişi</div></div><div class="recent-amount">${formatAmount(e.amount,e.currency)} ${e.currency}</div></div>`).join("");
  }

  function filteredExpenses(){
    const start=$("filterStart").value,end=$("filterEnd").value,user=$("filterUser").value,part=$("filterParticipant").value,currency=$("filterCurrency").value,payment=$("filterPayment").value;
    return activeExpenses().filter(e=>{const d=new Date(e.spent_at);if(start&&d<new Date(`${start}T00:00:00`))return false;if(end&&d>new Date(`${end}T23:59:59.999`))return false;if(user&&e.payer_id!==user)return false;if(part&&!e.participant_ids.includes(part))return false;if(currency&&e.currency!==currency)return false;if(payment&&e.payment_type!==payment)return false;return true;});
  }

  function renderReport(){
    const rows=filteredExpenses();$("recordCount").textContent=`${rows.length} kayıt`;$("reportEmpty").classList.toggle("hidden",rows.length>0);
    $("reportBody").innerHTML=rows.map(e=>{
      const people=e.participant_ids.map(id=>`<span class="pill">${escapeHtml(profileName(id))}</span>`).join("");
      const tl=e.payment_type==="Kart"&&e.currency!=="TL"?(e.card_tl_amount?`${formatAmount(e.card_tl_amount,"TL")} TL`:'<span class="status-provisional">Bekliyor</span>'):(e.currency==="TL"?`${formatAmount(e.amount,"TL")} TL`:"—");
      return `<tr data-id="${e.expense_id}" class="${currentProfile?.is_admin?"admin-clickable":""}"><td>${escapeHtml(e.description)}<span class="subtext">${formatDate(e.spent_at)} · v${e.version_no}</span></td><td class="number">${formatAmount(e.amount,e.currency)}</td><td>${e.currency}</td><td>${escapeHtml(e.payment_type)}</td><td>${escapeHtml(profileName(e.payer_id))}</td><td><div class="pill-list">${people}</div></td><td>${tl}</td></tr>`;
    }).join("");
    renderTotals(rows);renderDebts(rows);
    if(currentProfile?.is_admin)$("reportBody").querySelectorAll("tr[data-id]").forEach(r=>r.addEventListener("click",()=>openAdminModal(r.dataset.id)));
  }

  function renderTotals(rows){
    const map=new Map();allProfiles.forEach(p=>map.set(p.id,{MYR:0,VND:0,USD:0,TL:0}));
    rows.forEach(e=>map.get(e.payer_id)[e.currency]+=Number(e.amount));
    const used=[...map.entries()].filter(([,t])=>CURRENCIES.some(c=>t[c]!==0));
    const grid=$("totalsGrid");if(!used.length){grid.className="totals-grid empty-state";grid.textContent="Filtreye uygun toplam bulunamadı.";return;}
    grid.className="totals-grid";grid.innerHTML=used.map(([id,t])=>`<div class="total-card"><div class="total-user">${escapeHtml(profileName(id))}</div>${CURRENCIES.map(c=>`<div class="total-line"><span>${c}</span><strong>${formatAmount(t[c],c)}</strong></div>`).join("")}</div>`).join("");
  }

  function toMinor(amount,currency){return Math.round(Number(amount)*Math.pow(10,DECIMALS[currency]??2));}
  function fromMinor(minor,currency){return minor/Math.pow(10,DECIMALS[currency]??2);}
  function addNet(net,currency,userId,delta){if(!net[currency])net[currency]=new Map();net[currency].set(userId,(net[currency].get(userId)||0)+delta);}

  function renderDebts(rows){
    const net={};const provisionalCurrencies=new Set();
    rows.forEach(e=>{
      let currency=e.currency,amount=e.amount,provisional=false;
      if(e.payment_type==="Kart"&&e.currency!=="TL"){
        if(e.card_tl_amount){currency="TL";amount=e.card_tl_amount;}else provisional=true;
      }
      if(provisional)provisionalCurrencies.add(currency);
      const total=toMinor(amount,currency),ids=[...e.participant_ids].sort(),n=ids.length,base=Math.floor(total/n),rem=total%n;
      addNet(net,currency,e.payer_id,total);
      ids.forEach((id,i)=>addNet(net,currency,id,-(base+(i<rem?1:0))));
    });
    const debts=[];
    Object.entries(net).forEach(([currency,map])=>{
      const debtors=[...map.entries()].filter(([,v])=>v<0).map(([id,v])=>({id,amt:-v})).sort((a,b)=>b.amt-a.amt);
      const creditors=[...map.entries()].filter(([,v])=>v>0).map(([id,v])=>({id,amt:v})).sort((a,b)=>b.amt-a.amt);
      let i=0,j=0;while(i<debtors.length&&j<creditors.length){const x=Math.min(debtors[i].amt,creditors[j].amt);if(x>0)debts.push({debtor:debtors[i].id,creditor:creditors[j].id,minor:x,currency,provisional:provisionalCurrencies.has(currency)});debtors[i].amt-=x;creditors[j].amt-=x;if(debtors[i].amt===0)i++;if(creditors[j].amt===0)j++;}
    });
    $("debtEmpty").classList.toggle("hidden",debts.length>0);$("debtBody").innerHTML=debts.map(d=>`<tr><td>${escapeHtml(profileName(d.debtor))}</td><td>${escapeHtml(profileName(d.creditor))}</td><td class="number">${formatAmount(fromMinor(d.minor,d.currency),d.currency)}</td><td>${d.currency}</td><td class="${d.provisional?"status-provisional":"status-final"}">${d.provisional?"Geçici":"Kesin"}</td></tr>`).join("");
  }

  function clearFilters(){["filterStart","filterEnd","filterUser","filterParticipant","filterCurrency","filterPayment"].forEach(id=>$(id).value="");renderReport();}

  function openAdminModal(expenseId){
    if(!currentProfile?.is_admin)return;const e=currentExpenses.find(x=>x.expense_id===expenseId);if(!e)return;
    $("editExpenseId").value=e.expense_id;$("editDetail").value=e.description;$("editAmount").value=e.amount;$("editCurrency").value=e.currency;$("editPayment").value=e.payment_type;$("editPayer").value=e.payer_id;$("editCardTl").value=e.card_tl_amount||"";$("editReason").value="";
    $("editParticipantPicker").innerHTML=allProfiles.map(p=>participantCheckboxHtml(p,"edit",e.participant_ids.includes(p.id))).join("");toggleTlField();clearMessage($("adminMessage"));$("adminModal").classList.remove("hidden");
  }
  function toggleTlField(){const show=$("editPayment").value==="Kart"&&$("editCurrency").value!=="TL";$("editTlWrap").classList.toggle("hidden",!show);if(!show)$("editCardTl").value="";}
  function closeAdminModal(){$("adminModal").classList.add("hidden");clearMessage($("adminMessage"));}

  async function reviseExpense(e){
    e.preventDefault();if(!currentProfile?.is_admin)return;if(!navigator.onLine){showMessage($("adminMessage"),"warning","İnternet bağlantısı yok. Değişiklik kaydedilmedi.");return;}
    const ids=selectedParticipantIds("edit");if(!ids.length){showMessage($("adminMessage"),"error","En az bir borca ortak kişi seç.");return;}
    const cardTl=$("editCardTl").value?Number($("editCardTl").value):null;
    try{const {error}=await client.rpc("revise_expense",{p_expense_id:$("editExpenseId").value,p_payer_id:$("editPayer").value,p_description:$("editDetail").value.trim(),p_amount:Number($("editAmount").value),p_currency:$("editCurrency").value,p_payment_type:$("editPayment").value,p_participant_ids:ids,p_card_tl_amount:cardTl,p_change_reason:$("editReason").value.trim()||null});if(error)throw error;await loadBaseData();closeAdminModal();showToast("Yeni revizyon kaydedildi. Eski kayıt korunuyor.");}
    catch(err){showMessage($("adminMessage"),"error",isNetworkLikeError(err)?"Güncelleme yapılamadı. Bağlantıyı kontrol et.":err.message);}
  }

  async function voidExpense(){
    if(!currentProfile?.is_admin)return;if(!navigator.onLine){showMessage($("adminMessage"),"warning","İnternet bağlantısı yok. Kayıt iptal edilmedi.");return;}
    if(!confirm("Bu harcama aktif rapordan kaldırılsın mı? Eski kayıt silinmeyecek, iptal revizyonu eklenecek."))return;
    try{const {error}=await client.rpc("void_expense",{p_expense_id:$("editExpenseId").value,p_change_reason:$("editReason").value.trim()||"Admin tarafından iptal edildi"});if(error)throw error;await loadBaseData();closeAdminModal();showToast("Harcama iptal edildi; geçmiş kayıt korunuyor.");}catch(err){showMessage($("adminMessage"),"error",err.message);}
  }

  function downloadBlob(name,text,type){const blob=new Blob([text],{type});const url=URL.createObjectURL(blob);const a=document.createElement("a");a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
  function downloadFullBackup(){if(!currentProfile?.is_admin)return;const payload={exported_at:new Date().toISOString(),profiles:allProfiles,expense_versions:allVersions};downloadBlob(`travel-expenses-backup-${new Date().toISOString().slice(0,10)}.json`,JSON.stringify(payload,null,2),"application/json");showToast("Tam JSON yedeği indirildi.");}
  function csvCell(v){const s=String(v??"");return `"${s.replaceAll('"','""')}"`;}
  function exportCsv(){
    if(!currentProfile?.is_admin)return;const rows=activeExpenses();const head=["Harcama Detay","Harcama Tutar","Harcama Para Birimi","Harcama Kart/Cash","Harcayan Kişi","Borca Ortak Olanlar","Kart TL Karşılığı","Harcama Tarihi"];
    const lines=[head.map(csvCell).join(","),...rows.map(e=>[e.description,e.amount,e.currency,e.payment_type,profileName(e.payer_id),e.participant_ids.map(profileName).join(" | "),e.card_tl_amount||"",e.spent_at].map(csvCell).join(","))];downloadBlob(`travel-expenses-${new Date().toISOString().slice(0,10)}.csv`,`\uFEFF${lines.join("\n")}`,"text/csv;charset=utf-8");showToast("CSV indirildi.");
  }

  function switchPage(page){document.querySelectorAll(".nav-tab").forEach(t=>t.classList.toggle("active",t.dataset.page===page));document.querySelectorAll(".page").forEach(s=>s.classList.toggle("active",s.id===`page-${page}`));if(page==="report")renderReport();}
  async function logout(){await client.auth.signOut();setScreen("auth");}

  function bindEvents(){
    window.addEventListener("online",async()=>{updateOnlineState();showToast("İnternet bağlantısı geri geldi.");if(currentUser)try{await loadBaseData();}catch(_){}});window.addEventListener("offline",updateOnlineState);updateOnlineState();
    $("loginTab").addEventListener("click",()=>setAuthMode("login"));$("signupTab").addEventListener("click",()=>setAuthMode("signup"));$("authForm").addEventListener("submit",handleAuthSubmit);$("expenseForm").addEventListener("submit",saveExpense);$("logoutBtn").addEventListener("click",logout);$("accountLogoutBtn").addEventListener("click",logout);
    $("selectAllParticipants").addEventListener("click",()=>document.querySelectorAll('input[data-scope="add"]').forEach(x=>x.checked=true));
    document.querySelectorAll(".nav-tab").forEach(t=>t.addEventListener("click",()=>switchPage(t.dataset.page)));
    ["filterStart","filterEnd","filterUser","filterParticipant","filterCurrency","filterPayment"].forEach(id=>$(id).addEventListener("change",renderReport));$("clearFiltersBtn").addEventListener("click",clearFilters);$("refreshReportBtn").addEventListener("click",async()=>{try{await loadBaseData();showToast("Rapor yenilendi.");}catch(e){showToast("Rapor yenilenemedi.");}});
    $("closeAdminModal").addEventListener("click",closeAdminModal);$("adminModal").addEventListener("click",e=>{if(e.target===$("adminModal"))closeAdminModal();});$("adminEditForm").addEventListener("submit",reviseExpense);$("voidExpenseBtn").addEventListener("click",voidExpense);$("editPayment").addEventListener("change",toggleTlField);$("editCurrency").addEventListener("change",toggleTlField);
    $("backupJsonBtn").addEventListener("click",downloadFullBackup);$("exportCsvBtn").addEventListener("click",exportCsv);
  }

  bindEvents();setAuthMode("login");bootstrapSession();
})();
