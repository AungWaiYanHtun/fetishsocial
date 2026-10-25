
/* VideoSpace VIP client
   Displays VIP packages and membership status
   inside Telegram Mini Apps.
*/
(() => {
  "use strict";

  const cfg = window.VIDEOSPACE_CONFIG || {};
  const api = (cfg.VIP_API_URL || "").replace(/\/$/, "");
  const tg = window.Telegram?.WebApp;

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

    if (tg?.initData) {
      headers["X-Telegram-Init-Data"] = tg.initData;
    }

    const response = await fetch(`${api}${path}`, {
      ...options,
      headers
    });

    const data = await response.json().catch(() => ({}));

    if (!response.ok) {
      throw new Error(data.error || "Request failed.");
    }

    return data;
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
    list.textContent = "Loading VIP plans…";
    confirm.disabled = true;
    confirm.textContent = "★ Get VIP";

    try {
      const data = await request("/api/packages");
      const packages = Array.isArray(data.packages) ? data.packages : [];
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
      list.textContent = "Could not load VIP packages. Please try again later.";
      console.error("VIP packages error:", error);
    }
  }

  async function startPurchase(plan, button) {
    if (!tg?.initData) {
      alert("Please open this page from the official Telegram bot.");
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

  async function loadVipStatus(el) {
    try {
      const data = await request("/api/vip-status");
      el.textContent = data.active
        ? `VIP active until ${new Date(data.expiresAt).toLocaleString()}`
        : "Free membership — choose a VIP plan to unlock premium access.";

      el.classList.remove("hidden");
    } catch (error) {
      console.error("VIP status error:", error);
      el.textContent =
        "Could not verify VIP status. Reopen this page from the official Telegram bot.";
      el.classList.remove("hidden");
    }
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
