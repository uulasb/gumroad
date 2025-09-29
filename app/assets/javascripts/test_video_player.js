(function () {
  function init() {
    const el = document.getElementById("gumroad-player");
    if (!el || !window.jwplayer) return;
    const p = window.jwplayer("gumroad-player").setup({
      primary: "html5",
      preload: "auto",
      autostart: true,
      mute: true,
      controls: true,
      responsive: true,
      sources: [{ file: "/test-assets/sample.mp4", type: "mp4" }],
    });

    let lastKnownPosition = 0;
    let lastKnownDuration = 0;
    let recoveryAttempts = 0;
    let recovering = false;
    let hiddenAt = null;
    let stallTimer = null;
    const debouncedReloadAndResume = debounce(reloadAndResume, 250);

    function debounce(fn, wait) {
      let t;
      return function () {
        clearTimeout(t);
        t = setTimeout(fn, wait);
      };
    }

    function reloadAndResume() {
      if (recovering) return;
      if (recoveryAttempts >= 3) return;
      recovering = true;
      recoveryAttempts += 1;
      window.__RECOVERY_ATTEMPTS__ = recoveryAttempts;
      // simulate fresh signed URL, so Fake JW won't error again
      window.__EXPIRE_HLS__ = false;
      if (typeof p.__armAutoResume === "function") p.__armAutoResume();
      const item = p.getPlaylistItem();
      const pos = lastKnownPosition;
      p.load([item]);
      p.once("ready", () => {
        if (pos > 0) p.seek(pos);
        try {
          p.play(true);
        } catch (_) {}
        setTimeout(() => {
          try {
            p.play(true);
          } catch (_) {}
        }, 100);
        recovering = false;
      });
    }

    p.on("ready", () => {
      const el2 = document.getElementById("gumroad-player");
      if (el2) el2.setAttribute("data-testid", "jwplayer-ready");
    });
    p.on("time", (e) => {
      lastKnownPosition = (e && e.position) || 0;
      lastKnownDuration = (e && e.duration) || 0;
    });
    p.on("error", (e) => {
      const code = e && (e.code || (e.error && e.error.code));
      if (code === 403 || code === 410) debouncedReloadAndResume();
    });
    p.on("buffer", () => {
      if (stallTimer) clearTimeout(stallTimer);
      stallTimer = setTimeout(() => {
        if (p.getState && p.getState() === "buffering") debouncedReloadAndResume();
      }, 5000);
    });
    p.on("playing", () => {
      if (stallTimer) {
        clearTimeout(stallTimer);
        stallTimer = null;
      }
    });
    p.on("idle", () => {
      const nearEnd = lastKnownDuration > 0 && lastKnownPosition >= lastKnownDuration - 1.5;
      if (!nearEnd) debouncedReloadAndResume();
    });
    document.addEventListener("visibilitychange", () => {
      if (document.hidden) {
        hiddenAt = Date.now();
        return;
      }
      const t = hiddenAt;
      hiddenAt = null;
      // In test environment, trigger recovery immediately if HLS is expired
      // In production, require 5+ minute gap
      const isTestExpiry = window.__EXPIRE_HLS__ === true;
      const longPause = t && Date.now() - t >= 5 * 60 * 1000;
      if (isTestExpiry || longPause) {
        debouncedReloadAndResume();
        try {
          if (p && typeof p.play === "function") p.play(true);
        } catch (_) {}
        setTimeout(() => {
          try {
            if (p && typeof p.play === "function") p.play(true);
          } catch (_) {}
        }, 150);
      } else {
        try {
          if (p && typeof p.play === "function") p.play(true);
        } catch (_) {}
      }
    });

    // start playback
    p.play(true);
  }
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
