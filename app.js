(() => {
  "use strict";

  const $ = (id) => document.getElementById(id);
  const cfg = window.VIDEOSPACE_CONFIG || {};

  const configured = Boolean(
    typeof cfg.SUPABASE_URL === "string" &&
    cfg.SUPABASE_URL.startsWith("https://") &&
    typeof cfg.SUPABASE_ANON_KEY === "string" &&
    (
      cfg.SUPABASE_ANON_KEY.startsWith("sb_publishable_") ||
      cfg.SUPABASE_ANON_KEY.startsWith("eyJ")
    )
  );

  let authMode = "signin";
  let toastTimer;
  let db = null;
  let currentUser = null;
  let isAdmin = false;
  let videos = [];
  let categories = ["All"];
  let activeCategory = "All";
  let activeVideoView = "regular";
  let vipMembershipActive = false;
  let activeVideo = null;

  // Avoid logging configuration details in production.

  const escapeHTML = (value = "") =>
    String(value).replace(/[&<>"']/g, (c) => ({
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#39;"
    })[c]);

  const niceDate = (value) => {
    try {
      if (!value) return "";
      return new Intl.DateTimeFormat(undefined, {
        month: "short", day: "numeric", year: "numeric"
      }).format(new Date(value));
    } catch {
      return "";
    }
  };

  const toast = (message) => {
    const el = $("toast");
    if (!el) {
      console.log(message);
      return;
    }
    el.textContent = message;
    el.classList.add("show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.remove("show"), 3200);
  };

  function syncModalAdIsolation() {
    const modalIds = ["auth-modal", "upload-modal", "player-modal"];
    const modalOpen = modalIds.some((id) => {
      const el = $(id);
      return el && !el.classList.contains("hidden");
    });
    if (document.body) {
      document.body.classList.toggle("modal-active", modalOpen);
    }
  }

  const showModal = (name) => {
    const modal = $(name + "-modal");
    if (!modal) {
      console.error("Modal not found:", name + "-modal");
      return;
    }
    modal.classList.remove("hidden");
    syncModalAdIsolation();
  };

  const hideModal = (name) => {
    const modal = $(name + "-modal");
    if (!modal) return;
    modal.classList.add("hidden");
    syncModalAdIsolation();
  };

  const setNotice = (message) => {
    const el = $("notice");
    if (!el) return;
    el.textContent = message;
    el.classList.toggle("hidden", !message);
  };

  const setConnection = (text, good = false) => {
    const el = $("connection-status");
    if (!el) return;
    el.innerHTML =
      `<i style="background:${good ? "#73c99a" : "#caa45d"}"></i>` +
      escapeHTML(text);
  };

  const year = $("year");
  if (year) year.textContent = new Date().getFullYear();

  function renderCategories() {
    const wrap = $("categories");
    if (!wrap) return;
    wrap.innerHTML = categories.map((c) =>
      `<button class="category ${c === activeCategory ? "active" : ""}" ` +
      `data-category="${escapeHTML(c)}">` +
      `${c === "All" ? "✦ " : ""}${escapeHTML(c)}</button>`
    ).join("");
  }

  function renderVideos() {
    const search = $("search");
    const grid = $("video-grid");
    const empty = $("empty-state");
    const count = $("result-count");
    if (!grid || !search) return;

    const q = search.value.trim().toLowerCase();
    const filtered = videos.filter((v) =>
      (activeVideoView === "vip" ? !!v.is_vip : !v.is_vip) &&
      (activeCategory === "All" ||
        (v.category || "Entertainment") === activeCategory) &&
      `${v.title || ""} ${v.description || ""} ${v.category || ""}`
        .toLowerCase().includes(q)
    );

    if (count) {
      count.textContent =
        `${filtered.length} video${filtered.length === 1 ? "" : "s"}`;
    }

    grid.innerHTML = filtered.map((v) => {
      const thumbnail = v.thumbnail_url
        ? `<img src="${escapeHTML(v.thumbnail_url)}" alt="" loading="lazy" onerror="this.remove()">`
        : "";
      return `
        <article class="video-card" tabindex="0" role="button"
          data-video-id="${escapeHTML(v.id)}"
          aria-label="Play ${escapeHTML(v.title || "video")}">
          <div class="thumbnail">
            ${thumbnail}
            <span class="thumbnail-placeholder">F<span style="color:#e1c17d">✦</span></span>
            <span class="play-badge">▶</span>
          </div>
          <div class="card-content">
            <span class="card-category">${v.is_vip ? "👑 VIP · " : ""}${escapeHTML(v.category || "Entertainment")}</span>
            <h3 class="card-title">${escapeHTML(v.title || "Untitled video")}</h3>
            <p class="card-description">${escapeHTML(v.description || "Ready when you are. Press play to watch.")}</p>
            <div class="card-meta">
              <span>▶ ${Number(v.views || 0).toLocaleString()} views</span>
              <span>${niceDate(v.created_at)}</span>
            </div>
          </div>
        </article>`;
    }).join("");

    if (empty) empty.classList.toggle("hidden", filtered.length !== 0);
  }

  function updateAuthUI() {
    const authOpen = $("auth-open");
    const signOut = $("sign-out");
  const adminOpen = $("admin-open");
    if (authOpen) authOpen.classList.toggle("hidden", !!currentUser);
    if (signOut) signOut.classList.toggle("hidden", !currentUser);
    if (adminOpen) adminOpen.classList.toggle("hidden", !isAdmin);

    if (currentUser) {
      setConnection(isAdmin ? "Admin signed in" : "Signed in", true);
    } else {
      setConnection(configured ? "Connected" : "Demo mode", configured);
    }
  }

  async function refreshAdmin() {
    isAdmin = false;
    if (db && currentUser) {
      try {
        const { data, error } = await db.rpc("is_admin");
        if (!error) isAdmin = !!data;
        else console.warn("Admin check failed:", error.message);
      } catch (err) {
        console.warn("Admin check failed:", err.message);
      }
    }
    updateAuthUI();
  }

  async function loadVideos() {
    if (!configured || !db) {
      // Do not replace the owner's real library with demo/sample videos.
      // Show an empty state and a clear connection warning until Supabase is available.
      videos = [];
      categories = ["All"];
      renderCategories();
      renderVideos();
      setNotice("Supabase is not connected. Your saved videos have not been deleted; check config.js and the Supabase client connection.");
      const count = $("result-count");
      if (count) count.textContent = "0 videos — connection needed";
      setConnection("Database connection needed", false);
      return;
    }

    const grid = $("video-grid");
    if (grid) {
      grid.innerHTML = '<div class="loading-card"><span class="spinner"></span><p>Loading collection…</p></div>';
    }
    setNotice("");

    try {
      // The browser's public Supabase query intentionally returns Free videos only
      // under RLS. VIP metadata is fetched separately from the authenticated backend
      // and is never requested from the public website without Telegram initData.
      const { data, error } = await db.from("videos")
        .select("id,title,description,category,video_path,thumbnail_url,thumbnail_path,storage_bucket,views,created_at,is_vip")
        .eq("published", true)
        .eq("is_vip", false)
        .order("created_at", { ascending: false })
        .limit(100);

      if (error) throw error;
      const freeVideos = (data || []).map((v) => ({ ...v, is_vip: false }));
      let vipVideos = [];
      const tg = window.Telegram?.WebApp;
      const api = (cfg.VIP_API_URL || "").replace(/\/$/, "");
      if (tg?.initData && api) {
        try {
          const response = await fetch(`${api}/api/vip-videos`, {
            headers: { "X-Telegram-Init-Data": tg.initData },
            cache: "no-store"
          });
          if (response.ok) {
            const payload = await response.json();
            const list = Array.isArray(payload) ? payload : payload.videos;
            if (Array.isArray(list)) {
              vipVideos = list.map((v) => ({ ...v, is_vip: true }));
            }
          } else if (response.status !== 401 && response.status !== 403) {
            console.warn("VIP list request failed:", response.status);
          }
        } catch (vipError) {
          // Keep Free videos usable even if the VIP API is temporarily unavailable.
          console.warn("VIP list unavailable:", vipError);
        }
      }
      videos = [...freeVideos, ...vipVideos]
        .sort((a, b) => new Date(b.created_at || 0) - new Date(a.created_at || 0))
        .slice(0, 100);
      categories = ["All", ...new Set(
        videos.map((v) => v.category || "Entertainment")
      )];
      renderCategories();
      renderVideos();
    } catch (err) {
      videos = [];
      renderCategories();
      renderVideos();
      setNotice("Could not load videos. Check the SQL setup, table columns and database policies. Details: " + (err.message || "Unknown error"));
      console.error("Load videos failed:", err);
    }
  }

  async function openVideo(id) {
    const v = videos.find((item) => String(item.id) === String(id));
    if (!v) return;

    window.dispatchEvent(new CustomEvent("fetishsocial:video-open", {
      detail: { videoId: String(v.id) }
    }));

    let playbackUrl = "";

    if (v.is_vip) {
      // Server authorization is required for every VIP playback attempt.
      const tg = window.Telegram?.WebApp;
      const api = (cfg.VIP_API_URL || "").replace(/\/$/, "");
      if (!tg?.initData || !api) {
        toast("VIP videos can only be opened through the authenticated Telegram Mini App.");
        return;
      }

      try {
        const r = await fetch(`${api}/api/vip-video-url`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-Telegram-Init-Data": tg.initData
          },
          body: JSON.stringify({ videoId: String(v.id) }),
          cache: "no-store"
        });
        const result = await r.json().catch(() => ({}));
        if (!r.ok || result.active === false) {
          vipMembershipActive = false;
          if (window.confirm("👑 This video is for VIP members only. Get VIP now?")) {
            const buy = document.getElementById("vip-buy");
            if (buy) buy.click();
            else document.dispatchEvent(new CustomEvent("videospace:open-vip-plans"));
          }
          return;
        }
        playbackUrl = result.signedUrl || result.url || "";
        if (!playbackUrl || !/^https:\/\//i.test(playbackUrl)) {
          throw new Error("The VIP API did not return a valid HTTPS signed URL.");
        }
        vipMembershipActive = true;
      } catch (e) {
        console.error("VIP playback authorization failed:", e);
        toast("VIP video could not be authorized. Please try again.");
        return;
      }
    } else {
      // Derive Free URLs from storage paths; never fetch a raw video_url column.
      const path = v.video_path;
      if (path && db) {
        playbackUrl = db.storage
          .from(cfg.VIDEO_BUCKET || "videos")
          .getPublicUrl(path).data?.publicUrl || "";
      }
      if (!playbackUrl) {
        toast("This video has no usable storage path. Re-upload or migrate this video.");
        return;
      }
    }

    activeVideo = v;
    const deleteButton = $("player-delete");
    if (deleteButton) deleteButton.classList.toggle("hidden", !(isAdmin && currentUser));
    closePlayerOptionsMenu();

    const player = $("video-player");
    if (!player) {
      toast("Video player element is missing from index.html.");
      return;
    }

    player.src = playbackUrl;
    const category = $("player-category");
    const title = $("player-title");
    const description = $("player-description");
    const views = $("player-views");

    if (category) category.textContent = v.category || "Entertainment";
    if (title) title.textContent = v.title || "Untitled video";
    if (description) description.textContent = v.description || "";
    if (views) views.textContent = `${Number(v.views || 0).toLocaleString()} views`;

    showModal("player");

    if (db) {
      try {
        const { error } = await db.rpc("increment_video_views", {
          video_id_input: v.id
        });
        if (error) console.warn("View count update failed:", error.message);
      } catch (err) {
        console.warn("View count update failed:", err);
      }
      v.views = Number(v.views || 0) + 1;
      if (views) views.textContent = `${v.views.toLocaleString()} views`;
    }

    try {
      await player.play();
    } catch {
      // Some mobile browsers require a user tap to start playback.
    }
  }

  const demoVideos = [
    {id:"demo-1",title:"Golden Hour Sessions",description:"A warm, cinematic collection for your next slow evening.",category:"Entertainment",views:12840,created_at:"2026-09-21"},
    {id:"demo-2",title:"The Sound of the City",description:"Discover new sounds and hidden corners of the city.",category:"Music",views:8432,created_at:"2026-09-18"},
    {id:"demo-3",title:"Play Beyond the Ordinary",description:"Highlights, creative plays, and friendly competition.",category:"Gaming",views:6241,created_at:"2026-09-14"},
    {id:"demo-4",title:"A Weekend Away",description:"A short travel diary from a place worth remembering.",category:"Travel",views:5027,created_at:"2026-09-10"},
    {id:"demo-5",title:"Small Things, Big Ideas",description:"Quick ideas and useful things to learn today.",category:"Education",views:4210,created_at:"2026-09-06"},
    {id:"demo-6",title:"A Little More Laughter",description:"A light-hearted pick to brighten up your day.",category:"Comedy",views:3914,created_at:"2026-09-02"}
  ];

  function switchVideoView(view) {
    activeVideoView = view === "vip" ? "vip" : "regular";
    activeCategory = "All";
    const regular = $("regular-videos-btn"), vip = $("vip-videos-btn"), hero = $("vip-hero");
    if (regular) regular.classList.toggle("active", activeVideoView === "regular");
    if (vip) vip.classList.toggle("active", activeVideoView === "vip");
    if (hero) hero.classList.toggle("hidden", activeVideoView !== "vip");
    const heading = document.querySelector(".section-heading h2");
    if (heading) heading.innerHTML = activeVideoView === "vip" ? '👑 VIP <span class="gold-text">Videos</span>' : 'Explore <span class="gold-text">Videos</span>';
    renderCategories();
    renderVideos();
  }
  $("regular-videos-btn")?.addEventListener("click", () => switchVideoView("regular"));
  $("vip-videos-btn")?.addEventListener("click", () => switchVideoView("vip"));
  $("vip-page-buy")?.addEventListener("click", () => {
    const buy = $("vip-buy");
    if (buy) buy.click();
    else document.dispatchEvent(new CustomEvent("videospace:open-vip-plans"));
  });

  const categoriesEl = $("categories");
  if (categoriesEl) {
    categoriesEl.addEventListener("click", (e) => {
      const b = e.target.closest("[data-category]");
      if (!b) return;
      activeCategory = b.dataset.category;
      renderCategories();
      renderVideos();
    });
  }

  const grid = $("video-grid");
  if (grid) {
    grid.addEventListener("click", (e) => {
      const card = e.target.closest("[data-video-id]");
      if (card) openVideo(card.dataset.videoId);
    });
    grid.addEventListener("keydown", (e) => {
      if ((e.key === "Enter" || e.key === " ") &&
          e.target.matches("[data-video-id]")) {
        e.preventDefault();
        openVideo(e.target.dataset.videoId);
      }
    });
  }

  const search = $("search");
  if (search) search.addEventListener("input", renderVideos);
  const refresh = $("refresh");
  if (refresh) refresh.addEventListener("click", loadVideos);

  const authOpen = $("auth-open");
  if (authOpen) {
    authOpen.addEventListener("click", () => {
      authMode = "signin";
      const title = $("auth-title");
      const submit = $("auth-submit");
      const toggle = $("auth-toggle");
      const message = $("auth-message");
      if (title) title.innerHTML = 'Your space.<br><span class="gold-text">Your watchlist.</span>';
      if (submit) submit.textContent = "Sign in";
      if (toggle) toggle.textContent = "Need an account? Create one";
      if (message) message.textContent = "";
      showModal("auth");
    });
  }

  const authToggle = $("auth-toggle");
  if (authToggle) {
    authToggle.addEventListener("click", () => {
      authMode = authMode === "signin" ? "signup" : "signin";
      const title = $("auth-title");
      const submit = $("auth-submit");
      const toggle = $("auth-toggle");
      const message = $("auth-message");

      if (title) {
        title.innerHTML = authMode === "signup"
          ? 'Join the <span class="gold-text">community.</span>'
          : 'Your space.<br><span class="gold-text">Your watchlist.</span>';
      }
      if (submit) submit.textContent = authMode === "signup" ? "Create account" : "Sign in";
      if (toggle) toggle.textContent = authMode === "signup"
        ? "Already have an account? Sign in"
        : "Need an account? Create one";
      if (message) message.textContent = "";
    });
  }

  const authForm = $("auth-form");
  if (authForm) {
    authForm.addEventListener("submit", async (e) => {
      e.preventDefault();
      const message = $("auth-message");

      if (!db) {
        if (message) message.textContent = "Supabase is not initialized. Check config.js and reload.";
        return;
      }

      const emailEl = $("auth-email");
      const passwordEl = $("auth-password");
      const btn = $("auth-submit");
      if (!emailEl || !passwordEl || !btn) {
        if (message) message.textContent = "Login form fields are missing.";
        return;
      }

      const email = emailEl.value.trim();
      const password = passwordEl.value;
      btn.disabled = true;
      btn.textContent = "Please wait…";
      if (message) message.textContent = "";

      try {
        const result = authMode === "signup"
          ? await db.auth.signUp({ email, password })
          : await db.auth.signInWithPassword({ email, password });

        if (result.error) throw result.error;

        if (authMode === "signup" && !result.data.session) {
          if (message) message.textContent = "Account created. Check your email to confirm, then sign in.";
        } else {
          currentUser = result.data.user;
          await refreshAdmin();
          hideModal("auth");
          toast(isAdmin ? "Admin signed in successfully" : "Signed in successfully");
        }
      } catch (err) {
        if (message) message.textContent = err.message || "Authentication failed.";
      } finally {
        btn.disabled = false;
        btn.textContent = authMode === "signup" ? "Create account" : "Sign in";
      }
    });
  }

  const signOut = $("sign-out");
  if (signOut) {
    signOut.addEventListener("click", async () => {
      try {
        if (db) {
          const { error } = await db.auth.signOut();
          if (error) throw error;
        }
        currentUser = null;
        isAdmin = false;
        updateAuthUI();
        toast("Signed out");
      } catch (err) {
        toast("Sign out failed: " + (err.message || "Unknown error"));
      }
    });
  }

const playerDelete = $("player-delete");
  const playerOptionsToggle = $("player-options-toggle");
  const playerOptionsMenu = $("player-options-menu");
  const playerDownload = $("player-download");
  const playerSpeed = $("player-speed");
  const playerSpeedValue = $("player-speed-value");
  const player = $("video-player");
  let playbackSpeedIndex = 0;
  const playbackSpeeds = [1, 1.25, 1.5, 1.75, 2, 0.5, 0.75];

  function closePlayerOptionsMenu() {
    const menu = $("player-options-menu");
    const toggle = $("player-options-toggle");
    if (menu) menu.classList.add("hidden");
    if (toggle) toggle.setAttribute("aria-expanded", "false");
  }

  function openDeleteConfirmation(title) {
    return new Promise((resolve) => {
      const old = $("player-delete-confirm");
      if (old) old.remove();
      const backdrop = document.createElement("div");
      backdrop.id = "player-delete-confirm";
      backdrop.className = "player-confirm-backdrop";
      backdrop.innerHTML = `
        <section class="player-confirm-card" role="alertdialog" aria-modal="true" aria-labelledby="player-confirm-title" aria-describedby="player-confirm-message">
          <h3 id="player-confirm-title">Delete this video?</h3>
          <p id="player-confirm-message"></p>
          <div class="player-confirm-actions">
            <button type="button" class="player-confirm-cancel">Cancel</button>
            <button type="button" class="player-confirm-delete">Delete</button>
          </div>
        </section>`;
      backdrop.querySelector("#player-confirm-message").textContent =
        `Are you sure you want to permanently delete “${title}”? The video and its database record will be removed. This action cannot be undone.`;
      const finish = (value) => {
        backdrop.remove();
        resolve(value);
      };
      backdrop.querySelector(".player-confirm-cancel").addEventListener("click", () => finish(false));
      backdrop.querySelector(".player-confirm-delete").addEventListener("click", () => finish(true));
      backdrop.addEventListener("click", (event) => {
        if (event.target === backdrop) finish(false);
      });
      document.addEventListener("keydown", function escapeConfirm(event) {
        if (event.key === "Escape" && document.body.contains(backdrop)) {
          document.removeEventListener("keydown", escapeConfirm);
          finish(false);
        }
      });
      document.body.appendChild(backdrop);
      backdrop.querySelector(".player-confirm-cancel").focus();
    });
  }

  if (playerOptionsToggle && playerOptionsMenu) {
    playerOptionsToggle.addEventListener("click", () => {
      const willOpen = playerOptionsMenu.classList.contains("hidden");
      if (playerDelete) playerDelete.classList.toggle("hidden", !(isAdmin && currentUser));
      playerOptionsMenu.classList.toggle("hidden", !willOpen);
      playerOptionsToggle.setAttribute("aria-expanded", String(willOpen));
      if (willOpen && playerDownload && activeVideo) {
        playerDownload.href = player?.currentSrc || player?.src || "#";
        playerDownload.setAttribute("download", (activeVideo.title || "video").replace(/[^a-z0-9._ -]/gi, "_"));
      }
    });
    document.addEventListener("click", (event) => {
      if (!playerOptionsMenu.contains(event.target) && !playerOptionsToggle.contains(event.target)) {
        closePlayerOptionsMenu();
      }
    });
  }

  if (playerSpeed && player) {
    playerSpeed.addEventListener("click", () => {
      playbackSpeedIndex = (playbackSpeedIndex + 1) % playbackSpeeds.length;
      player.playbackRate = playbackSpeeds[playbackSpeedIndex];
      if (playerSpeedValue) playerSpeedValue.textContent = `${playbackSpeeds[playbackSpeedIndex]}×`;
    });
  }

  if (playerDelete) {
playerDelete.addEventListener("click", async () => {
  if (!db || !isAdmin || !currentUser || !activeVideo) {
    toast("Administrator access required.");
    playerDelete.classList.add("hidden");
    return;
  }

  const video = activeVideo;
  const title = video.title || "this video";
  closePlayerOptionsMenu();
  const confirmed = await openDeleteConfirmation(title);
  if (!confirmed) return;

  playerDelete.disabled = true;
  playerDelete.textContent = "Deleting…";
  try {
    // Re-check the current authenticated user's admin role immediately before deletion.
    const { data: adminResult, error: adminError } = await db.rpc("is_admin");
    if (adminError || adminResult !== true) throw new Error("Administrator permission could not be verified.");

    const videoBucket = video.storage_bucket || (video.is_vip
      ? (cfg.VIP_VIDEO_BUCKET || "vip-videos")
      : (cfg.VIDEO_BUCKET || "videos"));
    if (video.video_path) {
      const result = await db.storage.from(videoBucket).remove([video.video_path]);
      if (result.error) throw new Error(`Could not delete video file: ${result.error.message}`);
    }
    if (video.thumbnail_path) {
      const result = await db.storage.from(cfg.THUMBNAIL_BUCKET || "thumbnails").remove([video.thumbnail_path]);
      if (result.error) throw new Error(`Could not delete thumbnail: ${result.error.message}`);
    }

    // This SECURITY DEFINER RPC independently enforces admin permission server-side.
    const { data: deleted, error: deleteError } = await db.rpc("admin_delete_video", {
      video_id_input: video.id
    });
    if (deleteError) throw deleteError;
    if (deleted !== true) throw new Error("The database did not confirm deletion.");

    const player = $("video-player");
    if (player) {
      player.pause();
      player.removeAttribute("src");
      player.load();
    }
    activeVideo = null;
    hideModal("player");
    toast("Video and database record deleted.");
    await loadVideos();
  } catch (err) {
    console.error("Admin video deletion failed:", err);
    toast(`Delete failed: ${err.message || "Please check admin and Storage policies."}`);
  } finally {
    playerDelete.disabled = false;
    playerDelete.textContent = "Delete video";
  }
});
  }


  const adminOpen = $("admin-open");
  if (adminOpen) {
    adminOpen.addEventListener("click", () => {
      if (!isAdmin) {
        toast("Administrator access required.");
        return;
      }
      const message = $("upload-message");
      const form = $("upload-form");
      if (message) message.textContent = "";
      if (form) form.reset();
      showModal("upload");
    });
  }

  const uploadForm = $("upload-form");
  if (uploadForm) {
    uploadForm.addEventListener("submit", async (e) => {
      e.preventDefault();
      const message = $("upload-message");

      if (!db || !isAdmin || !currentUser) {
        if (message) message.textContent = "Only an authenticated administrator can upload.";
        return;
      }

      const file = $("video-file")?.files?.[0];
      const thumb = $("video-thumbnail")?.files?.[0];
      if (!file) {
        if (message) message.textContent = "Choose a video file first.";
        return;
      }

      if (file.size > 500 * 1024 * 1024) {
        if (message) message.textContent = "This file is over the 500 MB starter limit. Compress it first.";
        return;
      }

      const btn = $("upload-submit");
      const progress = $("upload-progress");
      const bar = progress?.querySelector("span");
      if (!btn || !progress || !bar) {
        if (message) message.textContent = "Upload form is missing required elements.";
        return;
      }

      btn.disabled = true;
      btn.textContent = "Uploading…";
      progress.classList.remove("hidden");
      bar.style.width = "8%";

      try {
        const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, "_");
        const videoPath = `${currentUser.id}/${crypto.randomUUID()}-${safeName}`;

        const isVipUpload = $("video-access")?.value === "true";
        const videoBucket = isVipUpload
          ? (cfg.VIP_VIDEO_BUCKET || "vip-videos")
          : (cfg.VIDEO_BUCKET || "videos");

        let result = await db.storage
          .from(videoBucket)
          .upload(videoPath, file, {
            contentType: file.type || "video/mp4",
            upsert: false
          });
        if (result.error) throw result.error;
        bar.style.width = "60%";

        // VIP objects belong in a private bucket; only the server may sign URLs.
        const videoPublicUrl = isVipUpload
          ? null
          : (db.storage.from(videoBucket).getPublicUrl(videoPath).data?.publicUrl || null);

        let thumbnailUrl = null;
        let thumbPath = null;

        if (thumb) {
          if (!thumb.type.startsWith("image/")) {
            throw new Error("Thumbnail must be an image.");
          }
          const safeThumb = thumb.name.replace(/[^a-zA-Z0-9._-]/g, "_");
          thumbPath = `${currentUser.id}/${crypto.randomUUID()}-${safeThumb}`;

          result = await db.storage
            .from(cfg.THUMBNAIL_BUCKET || "thumbnails")
            .upload(thumbPath, thumb, {
              contentType: thumb.type,
              upsert: false
            });
          if (result.error) throw result.error;

          thumbnailUrl = db.storage
            .from(cfg.THUMBNAIL_BUCKET || "thumbnails")
            .getPublicUrl(thumbPath).data.publicUrl;
        }

        bar.style.width = "85%";
        const row = {
          title: $("video-title")?.value.trim() || "",
          description: $("video-description")?.value.trim() || "",
          category: $("video-category")?.value || "Entertainment",
          video_url: videoPublicUrl,
          video_path: videoPath,
          thumbnail_url: thumbnailUrl,
          thumbnail_path: thumbPath,
          published: true,
          is_vip: isVipUpload,
          storage_bucket: videoBucket,
          uploaded_by: currentUser.id
        };

        const { error } = await db.from("videos").insert(row);
        if (error) throw error;

        bar.style.width = "100%";
        hideModal("upload");
        toast("Video published successfully");
        await loadVideos();
      } catch (err) {
        if (message) {
          message.textContent = (err.message || "Upload failed.") +
            " Check Supabase Storage and videos table policies.";
        }
        bar.style.width = "0%";
        console.error("Upload failed:", err);
      } finally {
        btn.disabled = false;
        btn.textContent = "Upload and publish";
        setTimeout(() => progress.classList.add("hidden"), 700);
      }
    });
  }

  document.querySelectorAll("[data-close]").forEach((el) => {
    el.addEventListener("click", () => {
      const name = el.dataset.close;
      if (name === "player") {
        activeVideo = null;
        closePlayerOptionsMenu();
        const playerDelete = $("player-delete");
        if (playerDelete) playerDelete.classList.add("hidden");
        const player = $("video-player");
        if (player) {
          player.pause();
          player.removeAttribute("src");
          player.load();
        }
      }
      hideModal(name);
    });
  });

  document.addEventListener("keydown", (e) => {
    if (e.key !== "Escape") return;
    ["auth", "upload", "player"].forEach(hideModal);
    const player = $("video-player");
    if (player) player.pause();
  });

  const adIsolationObserver = new MutationObserver(() => {
    if (document.body.classList.contains("modal-active")) {
      syncModalAdIsolation();
    }
  });

  adIsolationObserver.observe(document.documentElement, {
    childList: true,
    subtree: true
  });
  syncModalAdIsolation();

  async function init() {
    if (!configured || !window.supabase) {
      updateAuthUI();
      await loadVideos();
      return;
    }

    try {
      db = window.supabase.createClient(cfg.SUPABASE_URL, cfg.SUPABASE_ANON_KEY);
      const { data, error } = await db.auth.getSession();
      if (error) throw error;

      currentUser = data.session?.user || null;
      await refreshAdmin();

      db.auth.onAuthStateChange((_event, session) => {
        currentUser = session?.user || null;
        setTimeout(() => refreshAdmin(), 0);
      });

      await loadVideos();
    } catch (err) {
      updateAuthUI();
      setNotice("Supabase could not initialize: " + (err.message || "Unknown error"));
      videos = [];
      renderCategories();
      renderVideos();
      console.error("Initialization failed:", err);
    }
  }

  init();
})();
