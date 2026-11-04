(() => {
  "use strict";

  const cfg = window.APP_CONFIG || {};
  const isConfigured = Boolean(cfg.SUPABASE_URL && cfg.SUPABASE_PUBLISHABLE_KEY);
  const $ = (id) => document.getElementById(id);

  const AUTH_EMAIL_DOMAIN = cfg.AUTH_EMAIL_DOMAIN || "travel-expenses.app";

  const CURRENCIES = ["MYR", "VND", "USD", "TL"];
  const DECIMALS = { VND: 0, MYR: 2, USD: 2, TL: 2 };

  let client = null;
  let currentUser = null;
  let currentProfile = null;
  let allProfiles = [];
  let allVersions = [];
  let currentExpenses = [];
  let allSettlementVersions = [];
  let currentSettlements = [];
  let displayRateRows = [];
  let displayRates = { MYR: null, VND: null, USD: null, TL: 1 };
  let toastTimer = null;
  let reportDetailsExpanded = false;

  function setScreen(name) {
    ["setup", "auth", "app"].forEach((n) => $(n + "Screen").classList.toggle("hidden", n !== name));
  }

  function localToday() {
    const d = new Date();
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    return `${y}-${m}-${day}`;
  }

  function updateOnlineState() {
    $("offlineBanner").classList.toggle("hidden", navigator.onLine);
  }

  function showMessage(el, type, text) {
    el.className = `message ${type}`;
    el.textContent = text;
    el.classList.remove("hidden");
  }

  function clearMessage(el) {
    el.className = "message hidden";
    el.textContent = "";
  }

  function showToast(text) {
    $("toast").textContent = text;
    $("toast").classList.remove("hidden");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => $("toast").classList.add("hidden"), 2600);
  }

  function escapeHtml(v) {
    return String(v ?? "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  }

  function normalizeLoginName(value) {
    return String(value || "")
      .trim()
      .toLocaleLowerCase("tr-TR")
      .replaceAll("ı", "i")
      .replaceAll("ğ", "g")
      .replaceAll("ü", "u")
      .replaceAll("ş", "s")
      .replaceAll("ö", "o")
      .replaceAll("ç", "c")
      .normalize("NFKD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[^a-z0-9]+/g, ".")
      .replace(/^\.+|\.+$/g, "")
      .slice(0, 60);
  }

  function activeProfiles() {
    return allProfiles.filter((p) => p.is_active !== false);
  }

  function formatAmount(v, c) {
    return new Intl.NumberFormat("tr-TR", {
      minimumFractionDigits: DECIMALS[c] ?? 2,
      maximumFractionDigits: DECIMALS[c] ?? 2
    }).format(Number(v || 0));
  }

  function formatDateOnly(v) {
    if (!v) return "—";
    const [y, m, d] = String(v).slice(0, 10).split("-");
    return `${d}.${m}.${y}`;
  }

  function profileName(id) {
    return allProfiles.find((p) => p.id === id)?.username || "Bilinmiyor";
  }

  function lastPayerStorageKey() {
    return currentProfile?.id ? `tripSplitLastPayer:${currentProfile.id}` : null;
  }

  function getRememberedPayer() {
    try {
      const key = lastPayerStorageKey();
      return key ? localStorage.getItem(key) : null;
    } catch (_) {
      return null;
    }
  }

  function rememberPayer(id) {
    try {
      const key = lastPayerStorageKey();
      if (key && id) localStorage.setItem(key, id);
    } catch (_) {}
  }

  function choiceStorageKey(name) {
    return currentProfile?.id ? `tripSplitLastChoice:${currentProfile.id}:${name}` : null;
  }

  function getRememberedChoice(name) {
    try {
      const key = choiceStorageKey(name);
      return key ? localStorage.getItem(key) : null;
    } catch (_) {
      return null;
    }
  }

  function rememberChoice(name, value) {
    try {
      const key = choiceStorageKey(name);
      if (key && value) localStorage.setItem(key, value);
    } catch (_) {}
  }

  function originalEnteredBy(expenseId) {
    const first = allVersions.find((v) => v.expense_id === expenseId && Number(v.version_no) === 1);
    return first?.changed_by || null;
  }

  function canManageExpense(expenseId) {
    return Boolean(currentProfile && (currentProfile.is_admin || originalEnteredBy(expenseId) === currentProfile.id));
  }

  function originalSettlementEnteredBy(settlementId) {
    const first = allSettlementVersions.find((v) => v.settlement_id === settlementId && Number(v.version_no) === 1);
    return first?.changed_by || null;
  }

  function canManageSettlement(settlementId) {
    return Boolean(currentProfile && (currentProfile.is_admin || originalSettlementEnteredBy(settlementId) === currentProfile.id));
  }

  function isNetworkLikeError(e) {
    const m = String(e?.message || e || "").toLowerCase();
    return !navigator.onLine || m.includes("fetch") || m.includes("network") || m.includes("failed to fetch");
  }

  function latestExpensesFromVersions(versions) {
    const byId = new Map();
    versions.forEach((v) => {
      const prev = byId.get(v.expense_id);
      if (!prev || Number(v.version_no) > Number(prev.version_no)) byId.set(v.expense_id, v);
    });
    return [...byId.values()].sort((a, b) => String(b.spent_on).localeCompare(String(a.spent_on)) || new Date(b.created_at) - new Date(a.created_at));
  }

  function latestSettlementsFromVersions(versions) {
    const byId = new Map();
    versions.forEach((v) => {
      const prev = byId.get(v.settlement_id);
      if (!prev || Number(v.version_no) > Number(prev.version_no)) byId.set(v.settlement_id, v);
    });
    return [...byId.values()].sort((a, b) => String(b.spent_on).localeCompare(String(a.spent_on)) || new Date(b.created_at) - new Date(a.created_at));
  }

  function persistLocalMirror() {
    try {
      localStorage.setItem("tripSplitMirrorV35", JSON.stringify({
        saved_at: new Date().toISOString(),
        profiles: allProfiles,
        expense_versions: allVersions,
        settlement_versions: allSettlementVersions,
        display_rates: displayRateRows
      }));
    } catch (_) {}
  }

  async function bootstrapSession() {
    if (!isConfigured) {
      setScreen("setup");
      return;
    }

    client = window.supabase.createClient(cfg.SUPABASE_URL, cfg.SUPABASE_PUBLISHABLE_KEY, {
      auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false }
    });

    try {
      const rememberedLogin = localStorage.getItem("tripSplitLastLogin");
      if (rememberedLogin && $("loginUser")) $("loginUser").value = rememberedLogin;
    } catch (_) {}

    const { data: { session } } = await client.auth.getSession();
    if (session?.user) await enterApp(session.user);
    else setScreen("auth");

    client.auth.onAuthStateChange((event, sessionNow) => {
      if (event === "SIGNED_OUT" || !sessionNow?.user) {
        currentUser = null;
        currentProfile = null;
        setScreen("auth");
      }
    });
  }

  async function handleAuthSubmit(e) {
    e.preventDefault();
    clearMessage($("authMessage"));

    if (!navigator.onLine) {
      showMessage($("authMessage"), "warning", "İnternet bağlantısı yok. Giriş yapılamadı.");
      return;
    }

    const rawLogin = $("loginUser").value.trim();
    const loginName = normalizeLoginName(rawLogin);
    const password = $("password").value;
    if (!loginName || !password) return;

    const btn = $("authSubmit");
    btn.disabled = true;
    btn.textContent = "Giriş yapılıyor…";

    try {
      const email = `${loginName}@${AUTH_EMAIL_DOMAIN}`;
      const { data, error } = await client.auth.signInWithPassword({ email, password });
      if (error) throw error;
      try { localStorage.setItem("tripSplitLastLogin", rawLogin); } catch (_) {}
      await enterApp(data.user);
      $("password").value = "";
    } catch (err) {
      const msg = String(err?.message || "").toLowerCase();
      const inactive = msg.includes("banned") || msg.includes("ban") || msg.includes("disabled");
      showMessage(
        $("authMessage"),
        "error",
        isNetworkLikeError(err)
          ? "Giriş yapılamadı. İnternet bağlantısını kontrol et."
          : (inactive ? "Bu kullanıcı hesabı pasif durumda. Admin ile iletişime geç." : "Kullanıcı adı veya şifre hatalı.")
      );
    } finally {
      btn.disabled = false;
      btn.textContent = "Giriş Yap";
    }
  }

  async function enterApp(user) {
    currentUser = user;
    const { data, error } = await client
      .from("profiles")
      .select("id,username,login_name,is_admin,is_active")
      .eq("id", user.id)
      .single();

    if (error || !data) {
      await client.auth.signOut().catch(() => undefined);
      setScreen("auth");
      showMessage($("authMessage"), "error", "Profil bulunamadı veya hesap pasif. v3.11 migration'ını kontrol et.");
      return;
    }
    if (data.is_active === false) {
      await client.auth.signOut().catch(() => undefined);
      setScreen("auth");
      showMessage($("authMessage"), "error", "Bu kullanıcı hesabı pasif durumda.");
      return;
    }

    currentProfile = data;
    $("userChip").textContent = data.username;
    $("accountUsername").textContent = data.username;
    $("accountRole").textContent = data.is_admin ? "Admin" : "Kullanıcı";
    $("adminAccountPanel").classList.toggle("hidden", !data.is_admin);
    $("adminDateFilters").classList.toggle("hidden", !data.is_admin);

    const today = localToday();
    $("expenseDate").max = today;
    if (!$("expenseDate").value) $("expenseDate").value = today;
    $("editSpentOn").max = today;
    $("settlementDate").max = today;
    if (!$("settlementDate").value) $("settlementDate").value = today;
    $("editSettlementDate").max = today;

    const rememberedCurrency = getRememberedChoice("currency");
    if (CURRENCIES.includes(rememberedCurrency)) $("expenseCurrency").value = rememberedCurrency;
    const rememberedPayment = getRememberedChoice("payment");
    if (["Kart", "Cash"].includes(rememberedPayment)) $("expensePayment").value = rememberedPayment;
    const rememberedSettlementCurrency = getRememberedChoice("settlementCurrency");
    if (CURRENCIES.includes(rememberedSettlementCurrency)) $("settlementCurrency").value = rememberedSettlementCurrency;

    setScreen("app");
    switchPage("add");
    showEntryType("expense");
    await loadBaseData();
  }

  async function loadBaseData() {
    if (!navigator.onLine) {
      showToast("Çevrimdışı: son yüklenen veriler ekranda kalır.");
      return;
    }

    const [pRes, vRes, sRes, rRes] = await Promise.all([
      client.from("profiles").select("id,username,login_name,is_admin,is_active,created_at").order("username"),
      client.from("expense_versions").select("*").order("created_at", { ascending: false }).limit(20000),
      client.from("settlement_versions").select("*").order("created_at", { ascending: false }).limit(20000),
      client.from("display_rates").select("currency,tl_rate,updated_at,updated_by").order("currency")
    ]);

    if (pRes.error) throw pRes.error;
    if (vRes.error) throw vRes.error;
    if (sRes.error) throw sRes.error;

    allProfiles = pRes.data || [];
    allVersions = vRes.data || [];
    currentExpenses = latestExpensesFromVersions(allVersions);
    allSettlementVersions = sRes.data || [];
    currentSettlements = latestSettlementsFromVersions(allSettlementVersions);

    displayRateRows = rRes.error ? [] : (rRes.data || []);
    displayRates = { MYR: null, VND: null, USD: null, TL: 1 };
    displayRateRows.forEach((r) => {
      if (Object.prototype.hasOwnProperty.call(displayRates, r.currency) && r.tl_rate !== null) {
        displayRates[r.currency] = Number(r.tl_rate);
      }
    });

    persistLocalMirror();
    populateSelectors();
    renderParticipantPickers();
    renderDisplayRateAdmin();
    renderAdminUsers();
    renderReport();
    renderMyEntries();
  }

  function populateSelectors() {
    const profileOptions = '<option value="">Tümü</option>' + allProfiles.map((p) => `<option value="${p.id}">${escapeHtml(p.username)}${p.is_active === false ? " (Pasif)" : ""}</option>`).join("");
    ["filterUser", "filterParticipant"].forEach((id) => {
      const old = $(id).value;
      $(id).innerHTML = profileOptions;
      $(id).value = old;
    });

    const actives = activeProfiles();
    const activeOptions = actives.map((p) => `<option value="${p.id}">${escapeHtml(p.username)}</option>`).join("");
    const allUserOptions = allProfiles.map((p) => `<option value="${p.id}">${escapeHtml(p.username)}${p.is_active === false ? " (Pasif)" : ""}</option>`).join("");

    const oldExpensePayer = $("expensePayer").value;
    const rememberedPayer = getRememberedPayer();
    const preferredPayer = [oldExpensePayer, rememberedPayer, currentProfile?.id, actives[0]?.id]
      .find((id) => id && actives.some((p) => p.id === id)) || "";
    $("expensePayer").innerHTML = activeOptions;
    $("expensePayer").value = preferredPayer;

    // Düzenle ekranında eski/pasif kişilerin tarihsel kaydı korunabilsin.
    $("editPayer").innerHTML = allUserOptions;
    $("adminPasswordUser").innerHTML = allUserOptions;

    const rememberedSettlementFrom = getRememberedChoice("settlementFrom");
    const fromPreferred = [rememberedSettlementFrom, currentProfile?.id, actives[0]?.id].find((id) => id && actives.some((p) => p.id === id)) || "";
    $("settlementFrom").innerHTML = activeOptions;
    $("settlementTo").innerHTML = activeOptions;
    $("settlementFrom").value = fromPreferred;
    if ($("settlementTo").value === fromPreferred || !$("settlementTo").value) {
      $("settlementTo").value = actives.find((p) => p.id !== fromPreferred)?.id || fromPreferred;
    }

    $("editSettlementFrom").innerHTML = allUserOptions;
    $("editSettlementTo").innerHTML = allUserOptions;
  }

  function participantCheckboxHtml(p, scope, checked = true) {
    return `<label class="person-check"><input type="checkbox" data-scope="${scope}" value="${p.id}" ${checked ? "checked" : ""}><span>${escapeHtml(p.username)}</span></label>`;
  }

  function renderParticipantPickers() {
    const actives = activeProfiles();
    $("participantPicker").innerHTML = actives.map((p) => participantCheckboxHtml(p, "add", true)).join("") || '<span class="muted">Aktif kullanıcı bulunmuyor.</span>';
  }

  function selectedParticipantIds(scope) {
    return [...document.querySelectorAll(`input[data-scope="${scope}"]:checked`)].map((x) => x.value);
  }

  function showEntryType(type) {
    const settlement = type === "settlement";
    $("expenseForm").classList.toggle("hidden", settlement);
    $("settlementForm").classList.toggle("hidden", !settlement);
    $("showExpenseFormBtn").classList.toggle("active", !settlement);
    $("showSettlementFormBtn").classList.toggle("active", settlement);
    clearMessage($("expenseMessage"));
    clearMessage($("settlementMessage"));
  }

  async function saveExpense(e) {
    e.preventDefault();
    clearMessage($("expenseMessage"));

    if (!navigator.onLine) {
      showMessage($("expenseMessage"), "warning", "İnternet bağlantısı yok. Harcama kaydedilmedi.");
      return;
    }

    const participantIds = selectedParticipantIds("add");
    if (!participantIds.length) {
      showMessage($("expenseMessage"), "error", "En az bir borca ortak kişi seçmelisin.");
      return;
    }

    const description = $("expenseDetail").value.trim();
    const amount = Number($("expenseAmount").value);
    const spentOn = $("expenseDate").value;

    if (!description || !Number.isFinite(amount) || amount <= 0 || !spentOn) {
      showMessage($("expenseMessage"), "error", "Detay, tutar ve harcama tarihini kontrol et.");
      return;
    }

    const btn = $("saveExpenseBtn");
    btn.disabled = true;
    btn.textContent = "Kaydediliyor…";

    try {
      const payerId = $("expensePayer").value;
      if (!payerId || !allProfiles.some((p) => p.id === payerId)) throw new Error("Harcayan kişiyi seç.");
      rememberPayer(payerId);

      const { error } = await client.rpc("create_expense", {
        p_payer_id: payerId,
        p_description: description,
        p_amount: amount,
        p_currency: $("expenseCurrency").value,
        p_payment_type: $("expensePayment").value,
        p_participant_ids: participantIds,
        p_spent_on: spentOn
      });
      if (error) throw error;

      await loadBaseData();
      $("expenseDetail").value = "";
      $("expenseAmount").value = "";
      $("expenseDate").value = localToday();
      $("expensePayer").value = payerId;
      renderParticipantPickers();
      showMessage($("expenseMessage"), "success", "✓ Harcama kaydedildi.");
    } catch (err) {
      showMessage(
        $("expenseMessage"),
        "error",
        `✕ ${isNetworkLikeError(err) ? "Harcama kaydedilemedi. İnternet bağlantısını kontrol edip tekrar dene." : err.message}`
      );
    } finally {
      btn.disabled = false;
      btn.textContent = "Harcamayı Kaydet";
    }
  }

  async function saveSettlement(e) {
    e.preventDefault();
    clearMessage($("settlementMessage"));
    if (!navigator.onLine) {
      showMessage($("settlementMessage"), "warning", "İnternet bağlantısı yok. Borç ödemesi kaydedilmedi.");
      return;
    }

    const fromId = $("settlementFrom").value;
    const toId = $("settlementTo").value;
    const amount = Number($("settlementAmount").value);
    const currency = $("settlementCurrency").value;
    const spentOn = $("settlementDate").value;
    const note = $("settlementNote").value.trim();

    if (!fromId || !toId || fromId === toId) {
      showMessage($("settlementMessage"), "error", "Gönderen ve alan farklı kişiler olmalı.");
      return;
    }
    if (!Number.isFinite(amount) || amount <= 0 || !spentOn) {
      showMessage($("settlementMessage"), "error", "Tutar ve tarihi kontrol et.");
      return;
    }

    const btn = $("saveSettlementBtn");
    btn.disabled = true;
    btn.textContent = "Kaydediliyor…";
    try {
      const { error } = await client.rpc("create_settlement", {
        p_from_user_id: fromId,
        p_to_user_id: toId,
        p_amount: amount,
        p_currency: currency,
        p_spent_on: spentOn,
        p_note: note || null
      });
      if (error) throw error;
      rememberChoice("settlementFrom", fromId);
      rememberChoice("settlementCurrency", currency);
      await loadBaseData();
      $("settlementAmount").value = "";
      $("settlementNote").value = "";
      $("settlementDate").value = localToday();
      showMessage($("settlementMessage"), "success", "✓ Borç ödemesi kaydedildi. Gezi harcama toplamına eklenmedi.");
    } catch (err) {
      showMessage($("settlementMessage"), "error", `✕ ${isNetworkLikeError(err) ? "Kayıt yapılamadı. İnternet bağlantısını kontrol et." : err.message}`);
    } finally {
      btn.disabled = false;
      btn.textContent = "Borç Ödemesini Kaydet";
    }
  }

  function activeSettlements() {
    return currentSettlements.filter((s) => s.status === "active");
  }

  function activeExpenses() {
    return currentExpenses.filter((e) => e.status === "active");
  }

  function renderMyEntries() {
    if (!currentProfile) return;

    const expenseRows = currentExpenses
      .filter((e) => originalEnteredBy(e.expense_id) === currentProfile.id)
      .map((e) => ({ type: "expense", row: e }));
    const settlementRows = currentSettlements
      .filter((x) => originalSettlementEnteredBy(x.settlement_id) === currentProfile.id)
      .map((x) => ({ type: "settlement", row: x }));

    const rows = [...expenseRows, ...settlementRows].sort((a, b) =>
      String(b.row.spent_on).localeCompare(String(a.row.spent_on)) || new Date(b.row.created_at) - new Date(a.row.created_at)
    );

    $("myEntriesEmpty").classList.toggle("hidden", rows.length > 0);
    $("myEntriesList").innerHTML = rows.map(({ type, row }) => {
      const isActive = row.status === "active";
      if (type === "settlement") {
        return `<button type="button" class="my-entry-card settlement-entry ${isActive ? "" : "is-voided"}" data-type="settlement" data-id="${row.settlement_id}" ${isActive ? "" : "disabled"}>
          <div class="my-entry-top">
            <span class="my-entry-date">${formatDateOnly(row.spent_on)}</span>
            <span class="my-entry-status ${isActive ? "settlement-status" : "voided"}">${isActive ? "Borç Ödemesi" : "İptal"}</span>
          </div>
          <div class="my-entry-bottom">
            <span class="my-entry-detail">${escapeHtml(profileName(row.from_user_id))} → ${escapeHtml(profileName(row.to_user_id))}</span>
            <span class="my-entry-amount">${formatAmount(row.amount, row.currency)} ${row.currency}</span>
          </div>
          <div class="my-entry-meta">${row.note ? escapeHtml(row.note) : "Kişiler arası para transferi"}</div>
          <div class="my-entry-action">${isActive ? "Dokun → Düzelt / İptal Et" : `İptal edilmiş transfer • v${row.version_no}`}</div>
        </button>`;
      }

      const people = row.participant_ids.map(profileName).join(", ");
      return `<button type="button" class="my-entry-card ${isActive ? "" : "is-voided"}" data-type="expense" data-id="${row.expense_id}" ${isActive ? "" : "disabled"}>
        <div class="my-entry-top">
          <span class="my-entry-date">${formatDateOnly(row.spent_on)}</span>
          <span class="my-entry-status ${isActive ? "" : "voided"}">${isActive ? "Harcama" : "İptal"}</span>
        </div>
        <div class="my-entry-bottom">
          <span class="my-entry-detail">${escapeHtml(row.description)}</span>
          <span class="my-entry-amount">${formatAmount(row.amount, row.currency)} ${row.currency}</span>
        </div>
        <div class="my-entry-meta">Harcayan: ${escapeHtml(profileName(row.payer_id))} • ${escapeHtml(row.payment_type)}<br>Borca ortak: ${escapeHtml(people)}</div>
        <div class="my-entry-action">${isActive ? "Dokun → Düzelt / İptal Et" : `İptal edilmiş kayıt • v${row.version_no}`}</div>
      </button>`;
    }).join("");

    $("myEntriesList").querySelectorAll("button[data-id]:not([disabled])").forEach((button) => {
      button.addEventListener("click", () => {
        if (button.dataset.type === "settlement") openSettlementModal(button.dataset.id);
        else openAdminModal(button.dataset.id);
      });
    });
  }

  function filteredExpenses() {
    const user = $("filterUser").value;
    const part = $("filterParticipant").value;
    const currency = $("filterCurrency").value;
    const payment = $("filterPayment").value;
    const start = currentProfile?.is_admin ? $("filterStart").value : "";
    const end = currentProfile?.is_admin ? $("filterEnd").value : "";

    return activeExpenses().filter((e) => {
      if (user && e.payer_id !== user) return false;
      if (part && !e.participant_ids.includes(part)) return false;
      if (currency && e.currency !== currency) return false;
      if (payment && e.payment_type !== payment) return false;
      if (start && String(e.spent_on) < start) return false;
      if (end && String(e.spent_on) > end) return false;
      return true;
    });
  }

  function filteredSettlements() {
    const user = $("filterUser").value;
    const part = $("filterParticipant").value;
    const currency = $("filterCurrency").value;
    const payment = $("filterPayment").value;
    const start = currentProfile?.is_admin ? $("filterStart").value : "";
    const end = currentProfile?.is_admin ? $("filterEnd").value : "";

    return activeSettlements().filter((x) => {
      if (user && x.from_user_id !== user && x.to_user_id !== user) return false;
      if (part && x.from_user_id !== part && x.to_user_id !== part) return false;
      if (currency && x.currency !== currency) return false;
      // Kart/Cash filtresi yalnız harcamalara aittir. Seçiliyse settlement tablosunu o filtre görünümünden çıkar.
      if (payment) return false;
      if (start && String(x.spent_on) < start) return false;
      if (end && String(x.spent_on) > end) return false;
      return true;
    });
  }

  function renderReport() {
    if (!currentProfile) return;
    const rows = filteredExpenses();
    const settlements = filteredSettlements();
    const visibleRows = reportDetailsExpanded ? rows : rows.slice(0, 5);

    $("recordCount").textContent = `${rows.length} kayıt`;
    $("reportEmpty").classList.toggle("hidden", rows.length > 0);

    const toggleBtn = $("toggleReportDetailsBtn");
    const limitNote = $("reportLimitNote");
    if (rows.length > 5) {
      toggleBtn.classList.remove("hidden");
      toggleBtn.textContent = reportDetailsExpanded ? "Daralt — İlk 5 Kaydı Göster" : `Tümünü Göster (${rows.length} kayıt)`;
      limitNote.textContent = reportDetailsExpanded
        ? `Tüm ${rows.length} kayıt gösteriliyor.`
        : `Son 5 kayıt gösteriliyor. Toplam ${rows.length} kayıt var.`;
    } else {
      toggleBtn.classList.add("hidden");
      limitNote.textContent = rows.length ? `${rows.length} kayıt gösteriliyor.` : "Henüz harcama kaydı yok.";
    }

    $("reportBody").innerHTML = visibleRows.map((e) => {
      const people = e.participant_ids.map((id) => `<span class="pill">${escapeHtml(profileName(id))}</span>`).join("");
      const tl = e.payment_type === "Kart" && e.currency !== "TL"
        ? (e.card_tl_amount ? `${formatAmount(e.card_tl_amount, "TL")} TL` : '<span class="status-provisional">Bekliyor</span>')
        : (e.currency === "TL" ? `${formatAmount(e.amount, "TL")} TL` : "—");

      return `<tr data-id="${e.expense_id}" class="${currentProfile.is_admin ? "admin-clickable" : ""}">
        <td>${formatDateOnly(e.spent_on)}</td>
        <td>${escapeHtml(e.description)}<span class="subtext">v${e.version_no}</span></td>
        <td class="number">${formatAmount(e.amount, e.currency)}</td>
        <td>${e.currency}</td>
        <td>${escapeHtml(e.payment_type)}</td>
        <td>${escapeHtml(profileName(e.payer_id))}${currentProfile.is_admin ? `<span class="subtext">Giren: ${escapeHtml(profileName(originalEnteredBy(e.expense_id)))}</span>` : ""}</td>
        <td><div class="pill-list">${people}</div></td>
        <td>${tl}</td>
      </tr>`;
    }).join("");

    renderSettlementTable(settlements);
    renderApproxDebtCards(rows, settlements);
    renderSpendTotals(rows);
    renderTripApproxTotal(activeExpenses());
    renderDebts(rows, settlements);

    if (currentProfile.is_admin) {
      $("reportBody").querySelectorAll("tr[data-id]").forEach((r) => r.addEventListener("click", () => openAdminModal(r.dataset.id)));
      $("settlementBody").querySelectorAll("tr[data-id]").forEach((r) => r.addEventListener("click", () => openSettlementModal(r.dataset.id)));
    }
  }

  function renderSettlementTable(rows) {
    $("settlementCount").textContent = `${rows.length} kayıt`;
    $("settlementEmpty").classList.toggle("hidden", rows.length > 0);
    $("settlementBody").innerHTML = rows.map((x) => `
      <tr data-id="${x.settlement_id}" class="${currentProfile?.is_admin ? "admin-clickable" : ""}">
        <td>${formatDateOnly(x.spent_on)}</td>
        <td>${escapeHtml(profileName(x.from_user_id))}</td>
        <td>${escapeHtml(profileName(x.to_user_id))}</td>
        <td class="number">${formatAmount(x.amount, x.currency)}</td>
        <td>${x.currency}</td>
        <td>${escapeHtml(x.note || "—")}<span class="subtext">v${x.version_no}</span></td>
      </tr>`).join("");
  }

  function renderSpendTotals(rows) {
    const map = new Map();
    const approxMap = new Map();

    allProfiles.forEach((p) => {
      map.set(p.id, { MYR: 0, VND: 0, USD: 0, TL: 0 });
      approxMap.set(p.id, { minor: 0, missing: new Set() });
    });

    rows.forEach((e) => {
      if (!map.has(e.payer_id)) map.set(e.payer_id, { MYR: 0, VND: 0, USD: 0, TL: 0 });
      if (!approxMap.has(e.payer_id)) approxMap.set(e.payer_id, { minor: 0, missing: new Set() });

      map.get(e.payer_id)[e.currency] += Number(e.amount);

      const approx = approxMap.get(e.payer_id);
      const rate = rateFor(e.currency);
      if (!rate) {
        approx.missing.add(e.currency);
      } else {
        // Gezi yaklaşık toplamındakiyle aynı mantık: her harcama adminin genel kuru ile TL'ye çevrilir.
        approx.minor += toMinor(Number(e.amount) * rate, "TL");
      }
    });

    const used = [...map.entries()].filter(([, totals]) => CURRENCIES.some((c) => totals[c] !== 0));
    const grid = $("spendTotalsGrid");
    if (!used.length) {
      grid.className = "totals-grid empty-state";
      grid.textContent = "Henüz harcama toplamı bulunmuyor.";
      return;
    }

    grid.className = "totals-grid";
    grid.innerHTML = used.map(([id, totals]) => {
      const approx = approxMap.get(id) || { minor: 0, missing: new Set() };
      const missingNote = approx.missing.size
        ? `<div class="spend-approx-missing">Eksik kur: ${escapeHtml([...approx.missing].join(", "))}</div>`
        : "";

      return `<div class="total-card spend-total-card">
        <div class="total-user">${escapeHtml(profileName(id))}</div>
        ${CURRENCIES.map((c) => `<div class="total-line"><span>${c}</span><strong>${formatAmount(totals[c], c)}</strong></div>`).join("")}
        <div class="spend-approx-total">
          <span>Toplam Yaklaşık Harcama</span>
          <strong>${formatApproxTl(fromMinor(approx.minor, "TL"))}</strong>
        </div>
        ${missingNote}
      </div>`;
    }).join("");
  }

  function rateFor(currency) {
    return currency === "TL" ? 1 : Number(displayRates[currency] || 0);
  }

  function formatApproxTl(value) {
    const rounded = new Intl.NumberFormat("tr-TR", {
      minimumFractionDigits: 0,
      maximumFractionDigits: 0
    }).format(Number(value || 0));
    return `≈ ₺${rounded}`;
  }

  function calculateApproxTlDebts(rows, settlements = []) {
    const net = new Map();
    const missing = new Set();

    const add = (userId, delta) => net.set(userId, (net.get(userId) || 0) + delta);

    rows.forEach((e) => {
      const rate = rateFor(e.currency);
      if (!rate) {
        missing.add(e.currency);
        return;
      }

      // Yaklaşık bölüm bilinçli olarak adminin girdiği genel kuru kullanır.
      // Kartın tekil kesin TL tutarı bu özet hesabına karışmaz.
      const total = toMinor(Number(e.amount) * rate, "TL");
      const ids = [...e.participant_ids].sort();
      const n = ids.length;
      if (!n) return;
      const base = Math.floor(total / n);
      const rem = total % n;

      add(e.payer_id, total);
      ids.forEach((id, i) => add(id, -(base + (i < rem ? 1 : 0))));
    });

    // Settlement harcama değildir. Yalnız kişilerin net borç/alacak pozisyonunu değiştirir.
    settlements.forEach((x) => {
      const rate = rateFor(x.currency);
      if (!rate) {
        missing.add(x.currency);
        return;
      }
      const total = toMinor(Number(x.amount) * rate, "TL");
      add(x.from_user_id, total);
      add(x.to_user_id, -total);
    });

    const debtors = [...net.entries()]
      .filter(([, v]) => v < 0)
      .map(([id, v]) => ({ id, amt: -v }))
      .sort((a, b) => b.amt - a.amt);
    const creditors = [...net.entries()]
      .filter(([, v]) => v > 0)
      .map(([id, v]) => ({ id, amt: v }))
      .sort((a, b) => b.amt - a.amt);

    const debts = [];
    let i = 0, j = 0;
    while (i < debtors.length && j < creditors.length) {
      const x = Math.min(debtors[i].amt, creditors[j].amt);
      if (x > 0) debts.push({ debtor: debtors[i].id, creditor: creditors[j].id, minor: x });
      debtors[i].amt -= x;
      creditors[j].amt -= x;
      if (debtors[i].amt === 0) i++;
      if (creditors[j].amt === 0) j++;
    }

    return { debts, missing };
  }

  function renderApproxDebtCards(rows, settlements = []) {
    const { debts, missing } = calculateApproxTlDebts(rows, settlements);
    const grid = $("totalsGrid");
    const warning = $("approxDebtWarning");

    if (missing.size) {
      warning.textContent = `Yaklaşık hesap kısmi: ${[...missing].join(", ")} için admin kuru girilmemiş.`;
      warning.classList.remove("hidden");
    } else {
      warning.classList.add("hidden");
      warning.textContent = "";
    }

    grid.className = "totals-grid";
    grid.innerHTML = allProfiles.map((p) => {
      const outgoing = debts.filter((d) => d.debtor === p.id);
      const totalMinor = outgoing.reduce((sum, d) => sum + d.minor, 0);
      const lines = outgoing.length
        ? outgoing.map((d) => `<div class="total-line approx-debt-line"><span>${escapeHtml(profileName(d.creditor))}</span><strong>${formatApproxTl(fromMinor(d.minor, "TL"))}</strong></div>`).join("")
        : '<div class="approx-no-debt">Ödenecek yaklaşık borç yok</div>';

      return `<div class="total-card approx-debt-card ${p.is_active === false ? "inactive-profile-card" : ""}">
        <div class="total-user">${escapeHtml(p.username)}${p.is_active === false ? ' <span class="inactive-inline">Pasif</span>' : ""}</div>
        <div class="approx-card-caption">Kime yaklaşık ne kadar ödeyecek?</div>
        ${lines}
        <div class="approx-total-line"><span>Toplam Yaklaşık Borcu</span><strong>${formatApproxTl(fromMinor(totalMinor, "TL"))}</strong></div>
      </div>`;
    }).join("");
  }

  function renderTripApproxTotal(rows) {
    let totalMinor = 0;
    const missing = new Set();

    rows.forEach((e) => {
      const rate = rateFor(e.currency);
      if (!rate) {
        missing.add(e.currency);
        return;
      }
      totalMinor += toMinor(Number(e.amount) * rate, "TL");
    });

    $("tripApproxTotal").textContent = formatApproxTl(fromMinor(totalMinor, "TL"));
    const rateParts = ["MYR", "VND", "USD"]
      .filter((c) => rateFor(c))
      .map((c) => `${c} ${rateFor(c).toLocaleString("tr-TR", { maximumFractionDigits: 8 })} TL`);
    const missingText = missing.size ? ` • Eksik kur: ${[...missing].join(", ")}` : "";
    $("tripApproxMeta").textContent = `${rows.length} aktif harcama • ${rateParts.join(" • ") || "Kur bekleniyor"}${missingText}`;
  }

  function renderDisplayRateAdmin() {
    if (!currentProfile?.is_admin) return;
    ["MYR", "VND", "USD"].forEach((c) => {
      const el = $(`rate${c}`);
      if (el) el.value = displayRates[c] || "";
    });

    const latest = displayRateRows
      .filter((r) => r.updated_at)
      .sort((a, b) => new Date(b.updated_at) - new Date(a.updated_at))[0];
    $("displayRatesUpdated").textContent = latest
      ? `Son güncelleme: ${new Intl.DateTimeFormat("tr-TR", { dateStyle: "medium", timeStyle: "short" }).format(new Date(latest.updated_at))}`
      : "Henüz yaklaşık kur girilmedi.";
  }

  async function saveDisplayRates(e) {
    e.preventDefault();
    clearMessage($("displayRatesMessage"));
    if (!currentProfile?.is_admin) return;
    if (!navigator.onLine) {
      showMessage($("displayRatesMessage"), "warning", "İnternet bağlantısı yok. Kurlar kaydedilmedi.");
      return;
    }

    const myr = Number($("rateMYR").value);
    const vnd = Number($("rateVND").value);
    const usd = Number($("rateUSD").value);
    if (![myr, vnd, usd].every((x) => Number.isFinite(x) && x > 0)) {
      showMessage($("displayRatesMessage"), "error", "MYR, VND ve USD için sıfırdan büyük TL karşılığı gir.");
      return;
    }

    const btn = $("saveDisplayRatesBtn");
    btn.disabled = true;
    btn.textContent = "Kaydediliyor…";
    try {
      const { error } = await client.rpc("set_display_rates", { p_myr: myr, p_vnd: vnd, p_usd: usd });
      if (error) throw error;
      await loadBaseData();
      showMessage($("displayRatesMessage"), "success", "✓ Yaklaşık TL kurları kaydedildi. Harcama kayıtları değiştirilmedi.");
    } catch (err) {
      showMessage($("displayRatesMessage"), "error", isNetworkLikeError(err) ? "Kurlar kaydedilemedi. Bağlantıyı kontrol et." : err.message);
    } finally {
      btn.disabled = false;
      btn.textContent = "Yaklaşık Kurları Kaydet";
    }
  }

  function toMinor(amount, currency) {
    return Math.round(Number(amount) * Math.pow(10, DECIMALS[currency] ?? 2));
  }

  function fromMinor(minor, currency) {
    return minor / Math.pow(10, DECIMALS[currency] ?? 2);
  }

  function addNet(net, currency, userId, delta) {
    if (!net[currency]) net[currency] = new Map();
    net[currency].set(userId, (net[currency].get(userId) || 0) + delta);
  }

  function renderDebts(rows, settlements = []) {
    const net = {};
    const provisionalCurrencies = new Set();

    rows.forEach((e) => {
      let currency = e.currency;
      let amount = e.amount;
      let provisional = false;

      if (e.payment_type === "Kart" && e.currency !== "TL") {
        if (e.card_tl_amount) {
          currency = "TL";
          amount = e.card_tl_amount;
        } else {
          provisional = true;
        }
      }
      if (provisional) provisionalCurrencies.add(currency);

      const total = toMinor(amount, currency);
      const ids = [...e.participant_ids].sort();
      const n = ids.length;
      const base = Math.floor(total / n);
      const rem = total % n;

      addNet(net, currency, e.payer_id, total);
      ids.forEach((id, i) => addNet(net, currency, id, -(base + (i < rem ? 1 : 0))));
    });

    // Kişiler arası para transferi: gönderenin net pozisyonu artar, alanın azalır.
    // Gezi harcamasına eklenmez fakat borcu kapatır / ters bakiye oluşturabilir.
    settlements.forEach((x) => {
      const total = toMinor(x.amount, x.currency);
      addNet(net, x.currency, x.from_user_id, total);
      addNet(net, x.currency, x.to_user_id, -total);
    });

    const debts = [];
    Object.entries(net).forEach(([currency, map]) => {
      const debtors = [...map.entries()].filter(([, v]) => v < 0).map(([id, v]) => ({ id, amt: -v })).sort((a, b) => b.amt - a.amt);
      const creditors = [...map.entries()].filter(([, v]) => v > 0).map(([id, v]) => ({ id, amt: v })).sort((a, b) => b.amt - a.amt);
      let i = 0, j = 0;
      while (i < debtors.length && j < creditors.length) {
        const x = Math.min(debtors[i].amt, creditors[j].amt);
        if (x > 0) debts.push({ debtor: debtors[i].id, creditor: creditors[j].id, minor: x, currency, provisional: provisionalCurrencies.has(currency) });
        debtors[i].amt -= x;
        creditors[j].amt -= x;
        if (debtors[i].amt === 0) i++;
        if (creditors[j].amt === 0) j++;
      }
    });

    $("debtEmpty").classList.toggle("hidden", debts.length > 0);
    $("debtBody").innerHTML = debts.map((d) => `
      <tr>
        <td>${escapeHtml(profileName(d.debtor))}</td>
        <td>${escapeHtml(profileName(d.creditor))}</td>
        <td class="number">${formatAmount(fromMinor(d.minor, d.currency), d.currency)}</td>
        <td>${d.currency}</td>
        <td class="${d.provisional ? "status-provisional" : "status-final"}">${d.provisional ? "Geçici" : "Kesin"}</td>
      </tr>`).join("");
  }

  function clearFilters() {
    ["filterStart", "filterEnd", "filterUser", "filterParticipant", "filterCurrency", "filterPayment"].forEach((id) => $(id).value = "");
    reportDetailsExpanded = false;
    renderReport();
  }

  function openAdminModal(expenseId) {
    if (!canManageExpense(expenseId)) return;
    const e = currentExpenses.find((x) => x.expense_id === expenseId);
    if (!e || e.status !== "active") return;

    $("editExpenseId").value = e.expense_id;
    $("editSpentOn").value = e.spent_on;
    $("editDetail").value = e.description;
    $("editAmount").value = e.amount;
    $("editCurrency").value = e.currency;
    $("editPayment").value = e.payment_type;
    $("editPayer").value = e.payer_id;
    const enteredBy = originalEnteredBy(e.expense_id);
    $("editModalEyebrow").textContent = currentProfile.is_admin && enteredBy !== currentProfile.id ? "Admin Düzenleme" : "Kendi Kaydın";
    $("editAuditInfo").textContent = `İlk kaydı giren: ${profileName(enteredBy)} • Son revizyon: ${profileName(e.changed_by)}`;
    $("editCardTl").value = e.card_tl_amount || "";
    $("editReason").value = "";
    $("editParticipantPicker").innerHTML = allProfiles.map((p) => participantCheckboxHtml(p, "edit", e.participant_ids.includes(p.id))).join("");
    toggleTlField();
    clearMessage($("adminMessage"));
    $("adminModal").classList.remove("hidden");
  }

  function toggleTlField() {
    const show = $("editPayment").value === "Kart" && $("editCurrency").value !== "TL";
    $("editTlWrap").classList.toggle("hidden", !show);
    if (!show) $("editCardTl").value = "";
  }

  function closeAdminModal() {
    $("adminModal").classList.add("hidden");
    clearMessage($("adminMessage"));
  }

  async function reviseExpense(e) {
    e.preventDefault();
    if (!canManageExpense($("editExpenseId").value)) return;
    if (!navigator.onLine) {
      showMessage($("adminMessage"), "warning", "İnternet bağlantısı yok. Değişiklik kaydedilmedi.");
      return;
    }

    const ids = selectedParticipantIds("edit");
    if (!ids.length) {
      showMessage($("adminMessage"), "error", "En az bir borca ortak kişi seç.");
      return;
    }

    const cardTl = $("editCardTl").value ? Number($("editCardTl").value) : null;

    try {
      const { error } = await client.rpc("revise_expense", {
        p_expense_id: $("editExpenseId").value,
        p_payer_id: $("editPayer").value,
        p_description: $("editDetail").value.trim(),
        p_amount: Number($("editAmount").value),
        p_currency: $("editCurrency").value,
        p_payment_type: $("editPayment").value,
        p_participant_ids: ids,
        p_card_tl_amount: cardTl,
        p_spent_on: $("editSpentOn").value,
        p_change_reason: $("editReason").value.trim() || null
      });
      if (error) throw error;
      await loadBaseData();
      closeAdminModal();
      showToast("Yeni revizyon kaydedildi. Eski kayıt korunuyor.");
    } catch (err) {
      showMessage($("adminMessage"), "error", isNetworkLikeError(err) ? "Güncelleme yapılamadı. Bağlantıyı kontrol et." : err.message);
    }
  }

  async function voidExpense() {
    if (!canManageExpense($("editExpenseId").value)) return;
    if (!navigator.onLine) {
      showMessage($("adminMessage"), "warning", "İnternet bağlantısı yok. Kayıt iptal edilmedi.");
      return;
    }
    if (!confirm("Bu harcama aktif rapordan kaldırılsın mı? Eski kayıt silinmeyecek.")) return;

    try {
      const { error } = await client.rpc("void_expense", {
        p_expense_id: $("editExpenseId").value,
        p_change_reason: $("editReason").value.trim() || "Kayıt sahibi/admin tarafından iptal edildi"
      });
      if (error) throw error;
      await loadBaseData();
      closeAdminModal();
      showToast("Harcama iptal edildi; geçmiş kayıt korunuyor.");
    } catch (err) {
      showMessage($("adminMessage"), "error", err.message);
    }
  }

  function openSettlementModal(settlementId) {
    if (!canManageSettlement(settlementId)) return;
    const x = currentSettlements.find((row) => row.settlement_id === settlementId);
    if (!x || x.status !== "active") return;

    $("editSettlementId").value = x.settlement_id;
    $("editSettlementDate").value = x.spent_on;
    $("editSettlementFrom").value = x.from_user_id;
    $("editSettlementTo").value = x.to_user_id;
    $("editSettlementAmount").value = x.amount;
    $("editSettlementCurrency").value = x.currency;
    $("editSettlementNote").value = x.note || "";
    $("editSettlementReason").value = "";
    $("settlementAuditInfo").textContent = `İlk kaydı giren: ${profileName(originalSettlementEnteredBy(x.settlement_id))} • Son revizyon: ${profileName(x.changed_by)}`;
    clearMessage($("settlementEditMessage"));
    $("settlementModal").classList.remove("hidden");
  }

  function closeSettlementModal() {
    $("settlementModal").classList.add("hidden");
    clearMessage($("settlementEditMessage"));
  }

  async function reviseSettlement(e) {
    e.preventDefault();
    const settlementId = $("editSettlementId").value;
    if (!canManageSettlement(settlementId)) return;
    if (!navigator.onLine) {
      showMessage($("settlementEditMessage"), "warning", "İnternet bağlantısı yok. Değişiklik kaydedilmedi.");
      return;
    }

    const fromId = $("editSettlementFrom").value;
    const toId = $("editSettlementTo").value;
    const amount = Number($("editSettlementAmount").value);
    if (!fromId || !toId || fromId === toId) {
      showMessage($("settlementEditMessage"), "error", "Gönderen ve alan farklı kişiler olmalı.");
      return;
    }
    if (!Number.isFinite(amount) || amount <= 0) {
      showMessage($("settlementEditMessage"), "error", "Tutar sıfırdan büyük olmalı.");
      return;
    }

    try {
      const { error } = await client.rpc("revise_settlement", {
        p_settlement_id: settlementId,
        p_from_user_id: fromId,
        p_to_user_id: toId,
        p_amount: amount,
        p_currency: $("editSettlementCurrency").value,
        p_spent_on: $("editSettlementDate").value,
        p_note: $("editSettlementNote").value.trim() || null,
        p_change_reason: $("editSettlementReason").value.trim() || null
      });
      if (error) throw error;
      await loadBaseData();
      closeSettlementModal();
      showToast("Borç ödemesi revize edildi. Eski sürüm korunuyor.");
    } catch (err) {
      showMessage($("settlementEditMessage"), "error", isNetworkLikeError(err) ? "Güncelleme yapılamadı. Bağlantıyı kontrol et." : err.message);
    }
  }

  async function voidSettlement() {
    const settlementId = $("editSettlementId").value;
    if (!canManageSettlement(settlementId)) return;
    if (!navigator.onLine) {
      showMessage($("settlementEditMessage"), "warning", "İnternet bağlantısı yok. Transfer iptal edilmedi.");
      return;
    }
    if (!confirm("Bu borç ödemesi aktif borç hesabından çıkarılsın mı? Eski kayıt silinmeyecek.")) return;

    try {
      const { error } = await client.rpc("void_settlement", {
        p_settlement_id: settlementId,
        p_change_reason: $("editSettlementReason").value.trim() || "Kayıt sahibi/admin tarafından iptal edildi"
      });
      if (error) throw error;
      await loadBaseData();
      closeSettlementModal();
      showToast("Borç ödemesi iptal edildi; geçmiş kayıt korunuyor.");
    } catch (err) {
      showMessage($("settlementEditMessage"), "error", err.message);
    }
  }

  async function edgeFunctionErrorMessage(error, fallback = "Edge Function işlemi başarısız.") {
    try {
      if (error?.context && typeof error.context.json === "function") {
        const payload = await error.context.json();
        if (payload?.error) return String(payload.error);
        if (payload?.message) return String(payload.message);
      }
    } catch (_) {}

    const raw = String(error?.message || "");
    if (/404|not found/i.test(raw)) return "Edge Function 'admin-users' bulunamadı. v3.11 Edge Function kurulumu yapılmalı.";
    if (/invalid jwt|missing authorization|401/i.test(raw)) return "Admin oturumu doğrulanamadı. Çıkış yapıp tekrar giriş yap ve Edge Function JWT ayarını kontrol et.";
    if (isNetworkLikeError(error)) return "İşlem yapılamadı. İnternet bağlantısını kontrol et.";
    return raw || fallback;
  }

  async function invokeAdminUsers(payload) {
    const { data, error } = await client.functions.invoke("admin-users", { body: payload });
    if (error) throw new Error(await edgeFunctionErrorMessage(error));
    if (!data?.ok) throw new Error(data?.error || "Admin işlemi başarısız.");
    return data;
  }

  function renderAdminUsers() {
    if (!currentProfile?.is_admin || !$("adminUserList")) return;
    $("adminUserList").innerHTML = allProfiles.map((p) => {
      const active = p.is_active !== false;
      const disabled = p.is_admin || p.id === currentProfile.id;
      return `<div class="admin-user-row ${active ? "" : "is-inactive"}">
        <div class="admin-user-main">
          <strong>${escapeHtml(p.username)}</strong>
          <span>@${escapeHtml(p.login_name || "—")} • ${p.is_admin ? "Admin" : (active ? "Aktif" : "Pasif")}</span>
        </div>
        <button class="${active ? "danger" : "secondary"} admin-user-toggle" type="button" data-user-id="${p.id}" data-active="${active ? "1" : "0"}" ${disabled ? "disabled" : ""}>${active ? "Pasife Al" : "Aktifleştir"}</button>
      </div>`;
    }).join("");

    $("adminUserList").querySelectorAll(".admin-user-toggle:not([disabled])").forEach((btn) => {
      btn.addEventListener("click", () => setUserActive(btn.dataset.userId, btn.dataset.active !== "1"));
    });
  }

  async function createUser(e) {
    e.preventDefault();
    clearMessage($("createUserMessage"));
    if (!currentProfile?.is_admin) return;
    if (!navigator.onLine) {
      showMessage($("createUserMessage"), "warning", "İnternet bağlantısı yok. Kullanıcı oluşturulamadı.");
      return;
    }

    const username = $("adminCreateUsername").value.trim();
    const password = $("adminCreatePassword").value;
    if (username.length < 2) {
      showMessage($("createUserMessage"), "error", "Kullanıcı adı en az 2 karakter olmalı.");
      return;
    }
    if (password.length < 8) {
      showMessage($("createUserMessage"), "error", "Geçici şifre en az 8 karakter olmalı.");
      return;
    }

    const btn = $("adminCreateUserBtn");
    btn.disabled = true;
    btn.textContent = "Oluşturuluyor…";
    try {
      const data = await invokeAdminUsers({ action: "create_user", username, password });
      $("adminCreateUsername").value = "";
      $("adminCreatePassword").value = "";
      await loadBaseData();
      showMessage($("createUserMessage"), "success", `✓ ${data.user?.username || username} oluşturuldu. Giriş adı: ${data.user?.login_name || normalizeLoginName(username)}`);
    } catch (err) {
      showMessage($("createUserMessage"), "error", err.message);
    } finally {
      btn.disabled = false;
      btn.textContent = "Kullanıcı Oluştur";
    }
  }

  async function setUserActive(userId, active) {
    clearMessage($("userStatusMessage"));
    if (!currentProfile?.is_admin) return;
    const target = allProfiles.find((p) => p.id === userId);
    if (!target) return;
    if (!active && !confirm(`${target.username} pasife alınsın mı? Mevcut harcama geçmişi silinmeyecek.`)) return;

    try {
      const data = await invokeAdminUsers({ action: "set_active", target_user_id: userId, active });
      await loadBaseData();
      showMessage($("userStatusMessage"), "success", `✓ ${data.username || target.username} ${active ? "aktifleştirildi" : "pasife alındı"}.`);
    } catch (err) {
      showMessage($("userStatusMessage"), "error", err.message);
    }
  }

  async function changeUserPassword(e) {
    e.preventDefault();
    clearMessage($("passwordMessage"));
    if (!currentProfile?.is_admin) return;
    if (!navigator.onLine) {
      showMessage($("passwordMessage"), "warning", "İnternet bağlantısı yok. Şifre değiştirilemedi.");
      return;
    }

    const targetUserId = $("adminPasswordUser").value;
    const p1 = $("adminNewPassword").value;
    const p2 = $("adminNewPasswordConfirm").value;
    if (!targetUserId) {
      showMessage($("passwordMessage"), "error", "Kullanıcı seç.");
      return;
    }
    if (p1.length < 8) {
      showMessage($("passwordMessage"), "error", "Yeni şifre en az 8 karakter olmalı.");
      return;
    }
    if (p1 !== p2) {
      showMessage($("passwordMessage"), "error", "Yeni şifreler aynı değil.");
      return;
    }

    const btn = $("adminPasswordBtn");
    btn.disabled = true;
    btn.textContent = "Değiştiriliyor…";

    try {
      const data = await invokeAdminUsers({ action: "set_password", target_user_id: targetUserId, new_password: p1 });
      $("adminNewPassword").value = "";
      $("adminNewPasswordConfirm").value = "";
      showMessage($("passwordMessage"), "success", `✓ ${data.username || "Kullanıcı"} şifresi değiştirildi.`);
    } catch (err) {
      showMessage($("passwordMessage"), "error", err.message || "Şifre değiştirilemedi.");
    } finally {
      btn.disabled = false;
      btn.textContent = "Şifreyi Değiştir";
    }
  }

  function downloadBlob(name, text, type) {
    const blob = new Blob([text], { type });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = name;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  function downloadFullBackup() {
    if (!currentProfile?.is_admin) return;
    const payload = {
      exported_at: new Date().toISOString(),
      profiles: allProfiles,
      expense_versions: allVersions,
      settlement_versions: allSettlementVersions,
      display_rates: displayRateRows
    };
    downloadBlob(`tripsplit-backup-${localToday()}.json`, JSON.stringify(payload, null, 2), "application/json");
    showToast("Tam JSON yedeği indirildi.");
  }

  function csvCell(v) {
    const s = String(v ?? "");
    return `"${s.replaceAll('"', '""')}"`;
  }

  function exportCsv() {
    if (!currentProfile?.is_admin) return;
    const expenses = activeExpenses();
    const settlements = activeSettlements();
    const head = ["Kayıt Tipi", "Tarih", "Detay / Not", "Tutar", "Para", "Ödeme", "Gönderen / Harcayan", "Alan", "Kaydı Giren", "Borca Ortak Olanlar", "Kart TL Karşılığı"];
    const lines = [
      head.map(csvCell).join(","),
      ...expenses.map((e) => [
        "Harcama", e.spent_on, e.description, e.amount, e.currency, e.payment_type,
        profileName(e.payer_id), "", profileName(originalEnteredBy(e.expense_id)),
        e.participant_ids.map(profileName).join(" | "), e.card_tl_amount || ""
      ].map(csvCell).join(",")),
      ...settlements.map((x) => [
        "Borç Ödemesi", x.spent_on, x.note || "", x.amount, x.currency, "",
        profileName(x.from_user_id), profileName(x.to_user_id), profileName(originalSettlementEnteredBy(x.settlement_id)),
        "", ""
      ].map(csvCell).join(","))
    ];
    downloadBlob(`tripsplit-${localToday()}.csv`, `\uFEFF${lines.join("\n")}`, "text/csv;charset=utf-8");
    showToast("CSV indirildi.");
  }

  function switchPage(page) {
    document.querySelectorAll(".nav-tab").forEach((t) => t.classList.toggle("active", t.dataset.page === page));
    document.querySelectorAll(".page").forEach((s) => s.classList.toggle("active", s.id === `page-${page}`));
    $("appScreen").classList.toggle("entry-mode", page === "add");
    if (page === "report") renderReport();
    if (page === "mine") renderMyEntries();
    window.scrollTo({ top: 0, behavior: "instant" });
  }

  async function logout() {
    await client.auth.signOut();
    setScreen("auth");
  }

  function bindEvents() {
    window.addEventListener("online", async () => {
      updateOnlineState();
      showToast("İnternet bağlantısı geri geldi.");
      if (currentUser) {
        try { await loadBaseData(); } catch (_) {}
      }
    });
    window.addEventListener("offline", updateOnlineState);
    updateOnlineState();

    $("authForm").addEventListener("submit", handleAuthSubmit);

    $("showExpenseFormBtn").addEventListener("click", () => showEntryType("expense"));
    $("showSettlementFormBtn").addEventListener("click", () => showEntryType("settlement"));
    $("expenseForm").addEventListener("submit", saveExpense);
    $("settlementForm").addEventListener("submit", saveSettlement);

    $("expensePayer").addEventListener("change", () => rememberPayer($("expensePayer").value));
    $("expenseCurrency").addEventListener("change", () => rememberChoice("currency", $("expenseCurrency").value));
    $("expensePayment").addEventListener("change", () => rememberChoice("payment", $("expensePayment").value));
    $("settlementFrom").addEventListener("change", () => rememberChoice("settlementFrom", $("settlementFrom").value));
    $("settlementCurrency").addEventListener("change", () => rememberChoice("settlementCurrency", $("settlementCurrency").value));
    $("selectAllParticipants").addEventListener("click", () => document.querySelectorAll('input[data-scope="add"]').forEach((x) => x.checked = true));

    document.querySelectorAll(".nav-tab").forEach((t) => t.addEventListener("click", () => switchPage(t.dataset.page)));

    ["filterStart", "filterEnd", "filterUser", "filterParticipant", "filterCurrency", "filterPayment"].forEach((id) => $(id).addEventListener("change", () => {
      reportDetailsExpanded = false;
      renderReport();
    }));
    $("clearFiltersBtn").addEventListener("click", clearFilters);
    $("toggleReportDetailsBtn").addEventListener("click", () => {
      reportDetailsExpanded = !reportDetailsExpanded;
      renderReport();
    });
    $("refreshReportBtn").addEventListener("click", async () => {
      try { await loadBaseData(); showToast("Rapor yenilendi."); }
      catch (_) { showToast("Rapor yenilenemedi."); }
    });
    $("refreshMineBtn").addEventListener("click", async () => {
      try { await loadBaseData(); showToast("Kayıtların yenilendi."); }
      catch (_) { showToast("Kayıtların yenilenemedi."); }
    });

    $("closeAdminModal").addEventListener("click", closeAdminModal);
    $("adminModal").addEventListener("click", (e) => { if (e.target === $("adminModal")) closeAdminModal(); });
    $("adminEditForm").addEventListener("submit", reviseExpense);
    $("voidExpenseBtn").addEventListener("click", voidExpense);
    $("editPayment").addEventListener("change", toggleTlField);
    $("editCurrency").addEventListener("change", toggleTlField);

    $("closeSettlementModal").addEventListener("click", closeSettlementModal);
    $("settlementModal").addEventListener("click", (e) => { if (e.target === $("settlementModal")) closeSettlementModal(); });
    $("settlementEditForm").addEventListener("submit", reviseSettlement);
    $("voidSettlementBtn").addEventListener("click", voidSettlement);

    $("createUserForm").addEventListener("submit", createUser);
    $("passwordAdminForm").addEventListener("submit", changeUserPassword);
    $("displayRatesForm").addEventListener("submit", saveDisplayRates);
    $("backupJsonBtn").addEventListener("click", downloadFullBackup);
    $("exportCsvBtn").addEventListener("click", exportCsv);
    $("accountLogoutBtn").addEventListener("click", logout);
  }

  bindEvents();
  bootstrapSession();
})();
