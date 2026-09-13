(() => {
  "use strict";

  const cfg = window.APP_CONFIG || {};
  const isConfigured = Boolean(cfg.SUPABASE_URL && cfg.SUPABASE_PUBLISHABLE_KEY);
  const $ = (id) => document.getElementById(id);

  const LOGIN_USERS = {
    act:   { email: "act@travel-expenses.app", display: "ACT" },
    busra: { email: "busra@travel-expenses.app", display: "Büşra" },
    fatma: { email: "fatma@travel-expenses.app", display: "Fatma" },
    sena:  { email: "sena@travel-expenses.app", display: "Sena" }
  };

  const CURRENCIES = ["MYR", "VND", "USD", "TL"];
  const DECIMALS = { VND: 0, MYR: 2, USD: 2, TL: 2 };

  let client = null;
  let currentUser = null;
  let currentProfile = null;
  let allProfiles = [];
  let allVersions = [];
  let currentExpenses = [];
  let toastTimer = null;

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

  function originalEnteredBy(expenseId) {
    const first = allVersions.find((v) => v.expense_id === expenseId && Number(v.version_no) === 1);
    return first?.changed_by || null;
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

  function persistLocalMirror() {
    try {
      localStorage.setItem("tripSplitMirrorV32", JSON.stringify({
        saved_at: new Date().toISOString(),
        profiles: allProfiles,
        expense_versions: allVersions
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

    const key = $("loginUser").value;
    const userCfg = LOGIN_USERS[key];
    const password = $("password").value;
    if (!userCfg || !password) return;

    const btn = $("authSubmit");
    btn.disabled = true;
    btn.textContent = "Giriş yapılıyor…";

    try {
      const { data, error } = await client.auth.signInWithPassword({ email: userCfg.email, password });
      if (error) throw error;
      await enterApp(data.user);
      $("password").value = "";
    } catch (err) {
      showMessage(
        $("authMessage"),
        "error",
        isNetworkLikeError(err) ? "Giriş yapılamadı. İnternet bağlantısını kontrol et." : "Kullanıcı veya şifre hatalı."
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
      .select("id,username,is_admin")
      .eq("id", user.id)
      .single();

    if (error || !data) {
      setScreen("auth");
      showMessage($("authMessage"), "error", "Profil bulunamadı. v3.2 schema.sql dosyasını Supabase'te çalıştır.");
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

    setScreen("app");
    switchPage("add");
    await loadBaseData();
  }

  async function loadBaseData() {
    if (!navigator.onLine) {
      showToast("Çevrimdışı: son yüklenen veriler ekranda kalır.");
      return;
    }

    const [pRes, vRes] = await Promise.all([
      client.from("profiles").select("id,username,is_admin,created_at").order("username"),
      client.from("expense_versions").select("*").order("created_at", { ascending: false }).limit(20000)
    ]);

    if (pRes.error) throw pRes.error;
    if (vRes.error) throw vRes.error;

    allProfiles = pRes.data || [];
    allVersions = vRes.data || [];
    currentExpenses = latestExpensesFromVersions(allVersions);

    persistLocalMirror();
    populateSelectors();
    renderParticipantPickers();
    renderReport();
  }

  function populateSelectors() {
    const allOptions = '<option value="">Tümü</option>' + allProfiles.map((p) => `<option value="${p.id}">${escapeHtml(p.username)}</option>`).join("");
    ["filterUser", "filterParticipant"].forEach((id) => {
      const old = $(id).value;
      $(id).innerHTML = allOptions;
      $(id).value = old;
    });

    const payerOptions = allProfiles.map((p) => `<option value="${p.id}">${escapeHtml(p.username)}</option>`).join("");
    const oldExpensePayer = $("expensePayer").value;
    $("expensePayer").innerHTML = payerOptions;
    $("expensePayer").value = oldExpensePayer && allProfiles.some((p) => p.id === oldExpensePayer)
      ? oldExpensePayer
      : (currentProfile?.id || allProfiles[0]?.id || "");
    $("editPayer").innerHTML = payerOptions;
    $("adminPasswordUser").innerHTML = payerOptions;
  }

  function participantCheckboxHtml(p, scope, checked = true) {
    return `<label class="person-check"><input type="checkbox" data-scope="${scope}" value="${p.id}" ${checked ? "checked" : ""}><span>${escapeHtml(p.username)}</span></label>`;
  }

  function renderParticipantPickers() {
    $("participantPicker").innerHTML = allProfiles.map((p) => participantCheckboxHtml(p, "add", true)).join("") || '<span class="muted">Kullanıcılar henüz oluşturulmamış.</span>';
  }

  function selectedParticipantIds(scope) {
    return [...document.querySelectorAll(`input[data-scope="${scope}"]:checked`)].map((x) => x.value);
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
      $("expensePayer").value = currentProfile?.id || $("expensePayer").value;
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

  function activeExpenses() {
    return currentExpenses.filter((e) => e.status === "active");
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

  function renderReport() {
    if (!currentProfile) return;
    const rows = filteredExpenses();
    $("recordCount").textContent = `${rows.length} kayıt`;
    $("reportEmpty").classList.toggle("hidden", rows.length > 0);

    $("reportBody").innerHTML = rows.map((e) => {
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

    renderTotals(rows);
    renderDebts(rows);

    if (currentProfile.is_admin) {
      $("reportBody").querySelectorAll("tr[data-id]").forEach((r) => r.addEventListener("click", () => openAdminModal(r.dataset.id)));
    }
  }

  function renderTotals(rows) {
    const map = new Map();
    allProfiles.forEach((p) => map.set(p.id, { MYR: 0, VND: 0, USD: 0, TL: 0 }));
    rows.forEach((e) => {
      if (!map.has(e.payer_id)) map.set(e.payer_id, { MYR: 0, VND: 0, USD: 0, TL: 0 });
      map.get(e.payer_id)[e.currency] += Number(e.amount);
    });

    const used = [...map.entries()].filter(([, t]) => CURRENCIES.some((c) => t[c] !== 0));
    const grid = $("totalsGrid");
    if (!used.length) {
      grid.className = "totals-grid empty-state";
      grid.textContent = "Henüz toplam bulunmuyor.";
      return;
    }

    grid.className = "totals-grid";
    grid.innerHTML = used.map(([id, t]) => `
      <div class="total-card">
        <div class="total-user">${escapeHtml(profileName(id))}</div>
        ${CURRENCIES.map((c) => `<div class="total-line"><span>${c}</span><strong>${formatAmount(t[c], c)}</strong></div>`).join("")}
      </div>`).join("");
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

  function renderDebts(rows) {
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
    renderReport();
  }

  function openAdminModal(expenseId) {
    if (!currentProfile?.is_admin) return;
    const e = currentExpenses.find((x) => x.expense_id === expenseId);
    if (!e) return;

    $("editExpenseId").value = e.expense_id;
    $("editSpentOn").value = e.spent_on;
    $("editDetail").value = e.description;
    $("editAmount").value = e.amount;
    $("editCurrency").value = e.currency;
    $("editPayment").value = e.payment_type;
    $("editPayer").value = e.payer_id;
    const enteredBy = originalEnteredBy(e.expense_id);
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
    if (!currentProfile?.is_admin) return;
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
    if (!currentProfile?.is_admin) return;
    if (!navigator.onLine) {
      showMessage($("adminMessage"), "warning", "İnternet bağlantısı yok. Kayıt iptal edilmedi.");
      return;
    }
    if (!confirm("Bu harcama aktif rapordan kaldırılsın mı? Eski kayıt silinmeyecek.")) return;

    try {
      const { error } = await client.rpc("void_expense", {
        p_expense_id: $("editExpenseId").value,
        p_change_reason: $("editReason").value.trim() || "Admin tarafından iptal edildi"
      });
      if (error) throw error;
      await loadBaseData();
      closeAdminModal();
      showToast("Harcama iptal edildi; geçmiş kayıt korunuyor.");
    } catch (err) {
      showMessage($("adminMessage"), "error", err.message);
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
      const { data, error } = await client.functions.invoke("admin-set-password", {
        body: { target_user_id: targetUserId, new_password: p1 }
      });
      if (error) throw error;
      if (!data?.ok) throw new Error(data?.error || "Şifre değiştirilemedi.");
      $("adminNewPassword").value = "";
      $("adminNewPasswordConfirm").value = "";
      showMessage($("passwordMessage"), "success", `✓ ${data.username || "Kullanıcı"} şifresi değiştirildi.`);
    } catch (err) {
      const msg = String(err?.message || "");
      showMessage(
        $("passwordMessage"),
        "error",
        msg.includes("FunctionsHttpError") || msg.includes("404")
          ? "Şifre değiştirme fonksiyonu henüz kurulmamış. Supabase Edge Function 'admin-set-password' kurulmalı."
          : (isNetworkLikeError(err) ? "Şifre değiştirilemedi. Bağlantıyı kontrol et." : msg)
      );
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
    const payload = { exported_at: new Date().toISOString(), profiles: allProfiles, expense_versions: allVersions };
    downloadBlob(`tripsplit-backup-${localToday()}.json`, JSON.stringify(payload, null, 2), "application/json");
    showToast("Tam JSON yedeği indirildi.");
  }

  function csvCell(v) {
    const s = String(v ?? "");
    return `"${s.replaceAll('"', '""')}"`;
  }

  function exportCsv() {
    if (!currentProfile?.is_admin) return;
    const rows = activeExpenses();
    const head = ["Harcama Tarihi", "Harcama Detay", "Harcama Tutar", "Harcama Para Birimi", "Harcama Kart/Cash", "Harcayan Kişi", "Kaydı Giren", "Borca Ortak Olanlar", "Kart TL Karşılığı"];
    const lines = [
      head.map(csvCell).join(","),
      ...rows.map((e) => [
        e.spent_on,
        e.description,
        e.amount,
        e.currency,
        e.payment_type,
        profileName(e.payer_id),
        profileName(originalEnteredBy(e.expense_id)),
        e.participant_ids.map(profileName).join(" | "),
        e.card_tl_amount || ""
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
    $("expenseForm").addEventListener("submit", saveExpense);
    $("selectAllParticipants").addEventListener("click", () => document.querySelectorAll('input[data-scope="add"]').forEach((x) => x.checked = true));

    document.querySelectorAll(".nav-tab").forEach((t) => t.addEventListener("click", () => switchPage(t.dataset.page)));

    ["filterStart", "filterEnd", "filterUser", "filterParticipant", "filterCurrency", "filterPayment"].forEach((id) => $(id).addEventListener("change", renderReport));
    $("clearFiltersBtn").addEventListener("click", clearFilters);
    $("refreshReportBtn").addEventListener("click", async () => {
      try { await loadBaseData(); showToast("Rapor yenilendi."); }
      catch (_) { showToast("Rapor yenilenemedi."); }
    });

    $("closeAdminModal").addEventListener("click", closeAdminModal);
    $("adminModal").addEventListener("click", (e) => { if (e.target === $("adminModal")) closeAdminModal(); });
    $("adminEditForm").addEventListener("submit", reviseExpense);
    $("voidExpenseBtn").addEventListener("click", voidExpense);
    $("editPayment").addEventListener("change", toggleTlField);
    $("editCurrency").addEventListener("change", toggleTlField);

    $("passwordAdminForm").addEventListener("submit", changeUserPassword);
    $("backupJsonBtn").addEventListener("click", downloadFullBackup);
    $("exportCsvBtn").addEventListener("click", exportCsv);
    $("accountLogoutBtn").addEventListener("click", logout);
  }

  bindEvents();
  bootstrapSession();
})();
