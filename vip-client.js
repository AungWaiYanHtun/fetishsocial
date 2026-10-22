
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

    loadPackages();

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

  async function loadPackages() {
    const container = document.getElementById("vip-packages");

    // If the page has no package container, create one.
    let target = container;

    if (!target) {
      const anchor =
        document.getElementById("vip-status") ||
        document.querySelector("main") ||
        document.body;

      target = document.createElement("section");
      target.id = "vip-packages";
      target.style.cssText =
        "padding:16px;margin:16px 0;border-radius:14px;" +
        "background:rgba(128,128,128,.08);";

      anchor.insertAdjacentElement("afterend", target);
    }

    target.textContent = "Loading VIP packages…";

    try {
      const data = await request("/api/packages");
      const packages = Array.isArray(data.packages)
        ? data.packages
        : [];

      target.replaceChildren();

      const heading = document.createElement("h2");
      heading.textContent = "Choose Your VIP Plan";
      target.appendChild(heading);

      if (!packages.length) {
        target.textContent = "No VIP packages are available right now.";
        return;
      }

      packages.forEach((plan) => {
        const card = document.createElement("div");
        card.style.cssText =
          "padding:14px;margin:12px 0;border:1px solid #8885;" +
          "border-radius:12px;";

        const title = document.createElement("h3");
        title.textContent = plan.name || "VIP Membership";

        const duration = document.createElement("p");
        duration.textContent =
          `${Number(plan.duration_days) || 0} days`;

        const price = document.createElement("p");
        price.textContent =
          `⭐ ${Number(plan.stars_price) || 0} Telegram Stars`;

        const button = document.createElement("button");
        button.type = "button";
        button.textContent = "Get VIP";
        button.style.cssText =
          "padding:10px 18px;border:0;border-radius:8px;" +
          "cursor:pointer;font-weight:bold;";

        button.addEventListener("click", () => {
          startPurchase(plan, button);
        });

        card.append(title, duration, price, button);
        target.appendChild(card);
      });
    } catch (error) {
      target.textContent =
        "Could not load VIP packages. Please try again later.";
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
      const result = await request("/api/create-invoice", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ packageId: plan.id })
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
