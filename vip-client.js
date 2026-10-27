
/* VideoSpace VIP client
   Displays VIP packages and membership status
   inside Telegram Mini Apps.
*/
(() => {
  "use strict";

  const cfg = window.VIDEOSPACE_CONFIG || {};
  const api = (cfg.VIP_API_URL || "").replace(/\/$/, "");
  const tg = window.Telegram?.WebApp;
  // Package list changes infrequently; reuse it briefly so opening the modal again is fast.
  const PACKAGE_CACHE_MS = 60_000;
  const PACKAGE_TIMEOUT_MS = 8_000;
  let packageCache = null;
  let packageCacheAt = 0;
  let packageRequest = null;

  function init() {
    const statusEl = document.getElementById("vip-status");

    if (!api) {
      showError("VIP service is not configured.");
      return;
    }

    if (tg) tg.ready();

    const vipBuy = document.getElementById("vip-buy");
    if (vipBuy) vipBuy.addEventListener("click", () => loadPackages(true));
    document.addEventListener("videospace:open-vip-plans", () => loadPackages(true));

    if (statusEl && tg?.initData) {
      loadVipStatus(statusEl);
    }
  }

  function showError(message) {
    const el = document.getElementById("vip-packages");
    if (!el) return;
    el.textContent = message;
  }

  async function request(path, options = {}) {
    const headers = { ...(options.headers || {}) };
    const timeoutMs = Number(options.timeoutMs) || PACKAGE_TIMEOUT_MS;
    const fetchOptions = { ...options };
    delete fetchOptions.timeoutMs;

    if (tg?.initData) {
      headers["X-Telegram-Init-Data"] = tg.initData;
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    let response;
    try {
      response = await fetch(`${api}${path}`, {
        ...fetchOptions,
        headers,
        signal: options.signal || controller.signal
      });
    } catch (error) {
      if (error.name === "AbortError") {
        throw new Error("VIP service is taking too long to respond. Please retry.");
      }
      throw error;
    } finally {
      clearTimeout(timeout);
    }

    const data = await response.json().catch(() => ({}));

    if (!response.ok) {
      throw new Error(data.error || "Request failed.");
    }

    return data;
  }

  async function getPackages() {
    if (packageCache && Date.now() - packageCacheAt < PACKAGE_CACHE_MS) {
      return packageCache;
    }
    if (packageRequest) return packageRequest;

    packageRequest = request("/api/packages")
      .then((data) => {
        const packages = Array.isArray(data.packages) ? data.packages : [];
        packageCache = packages;
        packageCacheAt = Date.now();
        return packages;
      })
      .finally(() => {
        packageRequest = null;
      });
    return packageRequest;
  }

  async function loadPackages(show = false) {
    let target = document.getElementById("vip-packages");

    if (!target) {
      target = document.createElement("div");
      target.id = "vip-packages";
      target.className = "vip-plans-overlay";
      target.setAttribute("role", "dialog");
      target.setAttribute("aria-modal", "true");
      target.setAttribute("aria-labelledby", "vip-plans-title");
      target.innerHTML = `
        <button type="button" class="vip-plans-backdrop" aria-label="Close VIP plans"></button>
        <section class="vip-plans-panel">
          <button type="button" class="vip-plans-close" aria-label="Close VIP plans">×</button>
          <h2 id="vip-plans-title">Choose Your VIP Plan</h2>
          <p class="vip-plans-subtitle">Choose a plan, then continue to payment.</p>
          <div class="vip-plans-list" id="vip-plans-list"></div>
          <button type="button" class="vip-plans-confirm" id="vip-plans-confirm" disabled>★ Get VIP</button>
        </section>`;
      document.body.appendChild(target);

      const close = () => {
        target.classList.remove("is-open");
        document.body.classList.remove("vip-plans-open");
      };
      target.querySelector(".vip-plans-close")?.addEventListener("click", close);
      target.querySelector(".vip-plans-backdrop")?.addEventListener("click", close);
      document.addEventListener("keydown", (event) => {
        if (event.key === "Escape" && target.classList.contains("is-open")) close();
      });
    }

    if (!show) {
      target.classList.remove("is-open");
      document.body.classList.remove("vip-plans-open");
      return;
    }

    target.classList.add("is-open");
    document.body.classList.add("vip-plans-open");
    const list = target.querySelector("#vip-plans-list");
    const confirm = target.querySelector("#vip-plans-confirm");
    // Render cached data immediately when available; otherwise show a retry action on failure.
    const hasFreshCache = packageCache && Date.now() - packageCacheAt < PACKAGE_CACHE_MS;
    list.textContent = hasFreshCache ? "" : "Loading VIP plans…";
    confirm.disabled = true;
    confirm.textContent = "★ Get VIP";

    try {
      const packages = await getPackages();
      list.replaceChildren();

      if (!packages.length) {
        list.textContent = "No VIP packages are available right now.";
        return;
      }

      let selectedPlan = null;
      packages.forEach((plan, index) => {
        const card = document.createElement("button");
        card.type = "button";
        card.className = "vip-plan-option";
        card.setAttribute("aria-pressed", "false");
        const title = document.createElement("strong");
        title.textContent = plan.name || "VIP Membership";
        const duration = document.createElement("span");
        duration.textContent = `${Number(plan.duration_days) || 0} days`;
        const price = document.createElement("span");
        price.className = "vip-plan-price";
        price.textContent = `⭐ ${Number(plan.stars_price) || 0} Telegram Stars`;
        card.append(title, duration, price);
        card.addEventListener("click", () => {
          selectedPlan = plan;
          list.querySelectorAll(".vip-plan-option").forEach((item) => {
            item.classList.remove("selected");
            item.setAttribute("aria-pressed", "false");
          });
          card.classList.add("selected");
          card.setAttribute("aria-pressed", "true");
          confirm.disabled = false;
        });
        list.appendChild(card);
        if (index === 0) card.setAttribute("tabindex", "0");
      });

      confirm.onclick = () => {
        if (!selectedPlan) return;
        startPurchase(selectedPlan, confirm);
      };
    } catch (error) {
      list.replaceChildren();
      const message = document.createElement("p");
      message.textContent = error.message || "Could not load VIP packages.";
      const retry = document.createElement("button");
      retry.type = "button";
      retry.className = "vip-plan-option";
      retry.textContent = "Retry loading plans";
      retry.addEventListener("click", () => {
        packageCache = null;
        packageCacheAt = 0;
        loadPackages(true);
      });
      list.append(message, retry);
      console.error("VIP packages error:", error);
    }
  }

  function openBotForPlan(plan) {
    const username = String(cfg.TELEGRAM_BOT_USERNAME || "Fetish_OnlyFan_bot")
      .replace(/^@/, "")
      .trim();
    // A normal browser has no Telegram initData. Use the bot deep link rather
    // than showing a Mini-App-only warning. The bot backend must handle this
    // start payload and create the invoice from its own trusted package data.
    const rawId = String(plan?.id || "");
    const safeId = rawId.replace(/[^A-Za-z0-9_-]/g, "").slice(0, 48);
    const startPayload = safeId ? `vip_${safeId}` : "vip";
    const url = `https://t.me/${encodeURIComponent(username)}?start=${encodeURIComponent(startPayload)}`;

    // Close the plan dialog before navigating so the browser does not remain
    // on a modal if Telegram opens in the installed app.
    const modal = document.getElementById("vip-packages");
    modal?.classList.remove("is-open");
    document.body.classList.remove("vip-plans-open");

    // Assigning a top-level URL lets mobile browsers hand off to the Telegram
    // app when available, while still opening the bot's web page otherwise.
    window.location.assign(url);
  }

  async function startPurchase(plan, button) {
    // A normal browser has no Telegram initData. Hand off to the bot and pass the
    // selected package as a Telegram deep-link payload; the bot backend must handle
    // /start vip_<package-id> to preselect/create the matching invoice.
    if (!tg?.initData) {
      openBotForPlan(plan);
      return;
    }

    if (!plan?.id) {
      alert("This VIP package is missing its package ID.");
      return;
    }

    // Payment must be created and verified by the backend.
    // Do not trust a price supplied by the browser.
    button.disabled = true;
    button.textContent = "Connecting…";

    try {
      const result = await request("/api/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ packageId: plan.id, initData: tg.initData })
      });

      if (result.invoiceLink && tg.openInvoice) {
        tg.openInvoice(result.invoiceLink, (status) => {
          if (status === "paid") {
            alert("Payment successful! Refreshing VIP status…");
            const el = document.getElementById("vip-status");
            if (el) loadVipStatus(el);
          } else if (status === "cancelled") {
            alert("Payment cancelled.");
          } else if (status === "failed") {
            alert("Payment failed. Please try again.");
          }
        });
      } else if (result.invoiceLink) {
        window.open(result.invoiceLink, "_blank");
      } else {
        throw new Error(
          "The backend did not return an invoice link. " +
          "The payment endpoint may need to be configured."
        );
      }
    } catch (error) {
      console.error("VIP purchase error:", error);
      alert(error.message || "Could not start VIP payment.");
    } finally {
      button.disabled = false;
      button.textContent = "Get VIP";
    }
  }

  async function loadVipStatus(el, attempt = 0) {
    try {
      // Render's free instance may need time to wake up. Give this status request
      // a longer timeout than package-list requests so cold starts do not look
      // like a permanent login failure.
      const data = await request("/api/vip-status", { timeoutMs: 25_000 });
      const hero = document.getElementById("vip-hero");
      const heroButton = document.getElementById("vip-page-buy");
      const memberBadge = document.getElementById("vip-user-badge");
      const activeBadge = document.getElementById("vip-active-badge");
      const userIdEl = document.getElementById("vip-user-id");
      const heroExpiry = document.getElementById("vip-hero-expiry");

      if (data.active) {
        const expiresAt = data.expiresAt ? new Date(data.expiresAt) : null;
        const expiryText = expiresAt && !Number.isNaN(expiresAt.getTime())
          ? `VIP active until ${expiresAt.toLocaleString()}`
          : "Your VIP membership is active.";
        el.textContent = expiryText;
        el.classList.remove("hidden");
        memberBadge?.classList.remove("hidden");
        activeBadge?.classList.remove("hidden");
        const telegramId = tg?.initDataUnsafe?.user?.id;
        if (userIdEl && telegramId) {
          userIdEl.textContent = `Telegram ID: ${telegramId}`;
          userIdEl.classList.remove("hidden");
        }
        if (heroExpiry) {
          heroExpiry.textContent = expiryText;
          heroExpiry.classList.remove("hidden");
        }
        if (heroButton) heroButton.textContent = "↻ Extend VIP";
        hero?.classList.add("vip-member-active");
      } else {
        // A free membership is normal; do not show a warning for it.
        el.textContent = "";
        el.classList.add("hidden");
        memberBadge?.classList.add("hidden");
        activeBadge?.classList.add("hidden");
        userIdEl?.classList.add("hidden");
        heroExpiry?.classList.add("hidden");
        if (heroButton) heroButton.textContent = "★ Get VIP";
        hero?.classList.remove("vip-member-active");
      }
    } catch (error) {
      console.warn("VIP status check temporarily failed:", error);
      // Do not leave a scary error banner at the bottom of the website for a
      // transient Render cold start/network failure. Retry once in the background.
      el.textContent = "";
      el.classList.add("hidden");
      if (attempt < 1 && tg?.initData) {
        setTimeout(() => loadVipStatus(el, attempt + 1), 2500);
      }
    }
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
