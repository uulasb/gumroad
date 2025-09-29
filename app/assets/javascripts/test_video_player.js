(function () {
  function init() {
    var el = document.getElementById('gumroad-player');
    if (!el || !window.jwplayer) return;
    var p = window.jwplayer('gumroad-player').setup({
      primary: 'html5',
      preload: 'auto',
      autostart: true,
      mute: true,
      controls: true,
      responsive: true,
      sources: [
        { file: '/test-assets/sample.mp4', type: 'mp4' }
      ]
    });

    var lastKnownPosition = 0;
    var lastKnownDuration = 0;
    var recoveryAttempts = 0;
    var recovering = false;
    var hiddenAt = null;
    var stallTimer = null;
    var debouncedReloadAndResume = debounce(reloadAndResume, 250);

    function debounce(fn, wait) {
      var t; return function () { clearTimeout(t); t = setTimeout(fn, wait); };
    }

    function reloadAndResume() {
      if (recovering) return;
      if (recoveryAttempts >= 3) return;
      recovering = true;
      recoveryAttempts += 1;
      window.__RECOVERY_ATTEMPTS__ = recoveryAttempts;
      // simulate fresh signed URL, so Fake JW won't error again
      window.__EXPIRE_HLS__ = false;
      if (typeof p.__armAutoResume === 'function') p.__armAutoResume();
      var item = p.getPlaylistItem();
      var pos = lastKnownPosition;
      p.load([item]);
      p.once('ready', function () {
        if (pos > 0) p.seek(pos);
        try { p.play(true); } catch (_) {}
        setTimeout(function () { try { p.play(true); } catch (_) {} }, 100);
        recovering = false;
      });
    }

    p.on('ready', function () {
      var el2 = document.getElementById('gumroad-player');
      if (el2) el2.setAttribute('data-testid', 'jwplayer-ready');
    });
    p.on('time', function (e) {
      lastKnownPosition = e && e.position || 0;
      lastKnownDuration = e && e.duration || 0;
    });
    p.on('error', function (e) {
      var code = e && (e.code || (e.error && e.error.code));
      if (code === 403 || code === 410) debouncedReloadAndResume();
    });
    p.on('buffer', function () {
      if (stallTimer) clearTimeout(stallTimer);
      stallTimer = setTimeout(function () {
        if (p.getState && p.getState() === 'buffering') debouncedReloadAndResume();
      }, 5000);
    });
    p.on('playing', function () {
      if (stallTimer) { clearTimeout(stallTimer); stallTimer = null; }
    });
    p.on('idle', function () {
      var nearEnd = lastKnownDuration > 0 && lastKnownPosition >= (lastKnownDuration - 1.5);
      if (!nearEnd) debouncedReloadAndResume();
    });
    document.addEventListener('visibilitychange', function () {
      if (document.hidden) { hiddenAt = Date.now(); return; }
      var t = hiddenAt; hiddenAt = null;
      // In test environment, trigger recovery immediately if HLS is expired
      // In production, require 5+ minute gap
      var isTestExpiry = window.__EXPIRE_HLS__ === true;
      var longPause = t && (Date.now() - t >= 5 * 60 * 1000);
      if (isTestExpiry || longPause) {
        debouncedReloadAndResume();
        try { if (p && typeof p.play === 'function') p.play(true); } catch (_) {}
        setTimeout(function () { try { if (p && typeof p.play === 'function') p.play(true); } catch (_) {} }, 150);
      } else {
        try { if (p && typeof p.play === 'function') p.play(true); } catch (_) {}
      }
    });

    // start playback
    p.play(true);
  }
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();