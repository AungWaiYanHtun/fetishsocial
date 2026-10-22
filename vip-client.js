/* Shows membership status inside Telegram Mini Apps. */
(() => {
  const cfg = window.VIDEOSPACE_CONFIG || {};
  const el = document.getElementById("vip-status");
  const tg = window.Telegram?.WebApp;
  if (!el || !tg?.initData || !cfg.VIP_API_URL) return;
  tg.ready();
  fetch(`${cfg.VIP_API_URL.replace(/\/$/, "")}/api/vip-status`, {
    headers: {"X-Telegram-Init-Data": tg.initData}
  }).then(async r => {
    const data = await r.json();
    if (!r.ok) throw new Error(data.error || "Could not check membership.");
    el.textContent = data.active
      ? `VIP active until ${new Date(data.expiresAt).toLocaleString()}`
      : "Free membership — choose Get VIP to unlock premium access.";
    el.classList.remove("hidden");
  }).catch(() => {
    el.textContent = "Could not verify VIP status. Reopen this page from the official Telegram bot.";
    el.classList.remove("hidden");
  });
})();
