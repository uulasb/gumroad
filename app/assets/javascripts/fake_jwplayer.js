(function () {
  if (!window) return;
  function makePlayer(elOrId) {
    let state = "idle";
    let position = 0;
    const duration = 120;
    let item = { file: "/test-assets/sample.mp4" };
    let ticking = null;
    let shouldAutoResume = false;
    const handlers = {};
    const onceHandlers = {};
    window.__JW_TRACE__ = [];

    const api = {
      setup(opts) {
        if (opts && opts.sources && opts.sources[0]) {
          item = { file: opts.sources[0].file };
        } else if (opts && opts.file) {
          item = { file: opts.file };
        }
        state = "idle";
        position = 0;
        setTimeout(() => {
          window.__JW_TRACE__.push("ready(setup)");
          emit("ready", {});
          if (shouldAutoResume) {
            window.__JW_TRACE__.push("autoResume(setup)");
            api.play();
          }
        }, 0);
        return api;
      },
      on(evt, cb) {
        (handlers[evt] ||= []).push(cb);
      },
      once(evt, cb) {
        (onceHandlers[evt] ||= []).push(cb);
      },
      getState() {
        return state;
      },
      getPosition() {
        return position;
      },
      getDuration() {
        return duration;
      },
      getPlaylistItem() {
        return item;
      },
      __armAutoResume() {
        shouldAutoResume = true;
      },
      __debugState() {
        return { state, position, item, shouldAutoResume };
      },
      load(arr) {
        state = "idle";
        if (arr && arr[0]) item = arr[0];
        position = Math.max(0, position);
        setTimeout(() => {
          window.__JW_TRACE__.push("ready(load)");
          emit("ready", {});
          if (shouldAutoResume) {
            window.__JW_TRACE__.push("autoResume(load)");
            api.play();
          }
        }, 0);
      },
      seek(pos) {
        position = Math.max(0, Math.min(duration - 0.5, pos));
      },
      play() {
        window.__JW_TRACE__.push("play()");
        if (window.__EXPIRE_HLS__ === true) {
          // Simulate signed URL expiry surface (403/410)
          setTimeout(() => {
            window.__JW_TRACE__.push("emit(error 403)");
            emit("error", { code: 403 });
          }, 50);
          return;
        }
        if (state === "playing") return;
        state = "playing";
        shouldAutoResume = false;
        window.__JW_TRACE__.push("emit(playing)");
        emit("playing", {});
        if (ticking) clearInterval(ticking);
        ticking = setInterval(() => {
          position += 0.25;
          emit("time", { position, duration });
          if (position >= duration - 0.25) {
            clearInterval(ticking);
            ticking = null;
            state = "idle";
            window.__JW_TRACE__.push("emit(idle end)");
            emit("idle", {});
          }
        }, 250);
      },
      pause() {
        if (ticking) clearInterval(ticking);
        ticking = null;
        state = "paused";
        window.__JW_TRACE__.push("pause()");
      },
    };

    function emit(evt, payload) {
      (handlers[evt] || []).forEach((fn) => fn(payload));
      (onceHandlers[evt] || []).splice(0).forEach((fn) => fn(payload));
    }

    return api;
  }

  // global jwplayer shim
  window.jwplayer = function (elOrId) {
    // return a singleton per id for simplicity
    if (!window.__FAKE_JW_INST__) window.__FAKE_JW_INST__ = makePlayer(elOrId);
    return window.__FAKE_JW_INST__;
  };
})();
