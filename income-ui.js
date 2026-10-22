/* VideoSpace VIP controls. Payment is confirmed only by the backend Telegram webhook. */
(() => {
  const $ = id => document.getElementById(id);
  const message = text => {
    const el = $("income-message");
    if (!el) return;
    el.textContent = text;
    el.classList.remove("hidden");
    clearTimeout(window.__vipMessageTimer);
    window.__vipMessageTimer = setTimeout(() => el.classList.add("hidden"), 5000);
  };
  $("vip-buy")?.addEventListener("click", async () => {
    const cfg = window.VIDEOSPACE_CONFIG || {};
    if (!cfg.VIP_API_URL || !cfg.TELEGRAM_BOT_USERNAME || cfg.TELEGRAM_BOT_USERNAME === "YOUR_BOT_USERNAME") {
      message("VIP checkout is not configured yet. Set the backend URL and bot username in config.js.");
      return;
    }
    const tg = window.Telegram?.WebApp;
    if (tg?.initData) {
      tg.ready();
      try {
        const res = await fetch(`${cfg.VIP_API_URL.replace(/\/$/, "")}/api/checkout`, {
          method: "POST", headers: {"Content-Type":"application/json"},
          body: JSON.stringify({ initData: tg.initData, packageId: "vip_month" })
        });
        const result = await res.json();
        if (!res.ok) throw new Error(result.error || "Could not create checkout.");
        if (result.invoiceLink) tg.openInvoice(result.invoiceLink, status => {
          if (status === "paid") message("Payment received. Refresh VIP status in a moment.");
          else if (status === "failed") message("Payment failed. Please try again.");
        });
        else if (result.botUrl) window.location.href = result.botUrl;
      } catch (e) { message(e?.message || "VIP checkout is temporarily unavailable."); }
    } else {
      const startUrl = `https://t.me/${encodeURIComponent(cfg.TELEGRAM_BOT_USERNAME)}?start=vip`;
      window.open(startUrl, "_blank", "noopener,noreferrer");
      message("Open the official bot in Telegram to buy VIP with Stars.");
    }
  });
})();
