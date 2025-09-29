import debounce from "lodash/debounce";
import throttle from "lodash/throttle";
import * as React from "react";
import { createCast } from "ts-safe-cast";

import { createConsumptionEvent } from "$app/data/consumption_analytics";
import { trackMediaLocationChanged } from "$app/data/media_location";
import GuidGenerator from "$app/utils/guid_generator";
import { createJWPlayer } from "$app/utils/jwPlayer";
import { register } from "$app/utils/serverComponentUtil";

import { TranscodingNoticeModal } from "$app/components/Download/TranscodingNoticeModal";
import { useRunOnce } from "$app/components/useRunOnce";

const LOCATION_TRACK_EVENT_DELAY_MS = 10_000;

// Recovery constants
const MAX_RECOVERY_ATTEMPTS = 3;
const BUFFERING_STALL_TIMEOUT_MS = 5000;
const VISIBILITY_RECOVERY_THRESHOLD_MS = 5 * 60 * 1000;
const NEAR_END_THRESHOLD_S = 1.5;
const RECOVERY_DEBOUNCE_MS = 250;

// Recovery event types
interface JWPlayerErrorEvt {
  code?: number;
  error?: { code?: number };
}
interface JWPlayerTimeEvt {
  position: number;
  duration: number;
}
interface JWPlayerSeekEvt {
  offset: number;
}

type SubtitleFile = {
  file: string;
  label: string;
  kind: "captions";
};

type Video = {
  sources: string[];
  guid: string;
  title: string;
  tracks: SubtitleFile[];
  external_id: string;
  latest_media_location: { location: number } | null;
  content_length: number | null;
};

const fakeVideoUrlGuidForObfuscation = "ef64f2fef0d6c776a337050020423fc0";

export const VideoStreamPlayer = ({
  playlist: initialPlaylist,
  index_to_play,
  url_redirect_id,
  purchase_id,
  should_show_transcoding_notice,
  transcode_on_first_sale,
}: {
  playlist: Video[];
  index_to_play: number;
  url_redirect_id: string;
  purchase_id: string | null;
  should_show_transcoding_notice: boolean;
  transcode_on_first_sale: boolean;
}) => {
  const containerRef = React.useRef<HTMLDivElement>(null);

  useRunOnce(() => {
    const createPlayer = async () => {
      if (!containerRef.current) return;

      const playerId = `video-player-${GuidGenerator.generate()}`;
      containerRef.current.id = playerId;

      let lastPlayedId: number | undefined;
      let isInitialSeekDone = false;
      const playlist = initialPlaylist;

      // Recovery state variables
      let lastKnownPosition = 0;
      let lastKnownDuration = 0;
      let recoveryAttempts = 0;
      let recovering = false;
      let hiddenAt: number | null = null;
      let stallTimer: ReturnType<typeof setTimeout> | null = null;

      const player = await createJWPlayer(playerId, {
        width: "100%",
        height: "100%",
        playlist: playlist.map((video) => ({
          sources: video.sources.map((source) => ({
            file: source.replace(fakeVideoUrlGuidForObfuscation, video.guid),
          })),
          tracks: video.tracks,
          title: video.title,
        })),
      });

      const updateLocalMediaLocation = (position: number, duration: number) => {
        const videoFile = playlist[player.getPlaylistIndex()];
        if (videoFile && isInitialSeekDone && lastPlayedId === player.getPlaylistIndex()) {
          const location = position === duration ? 0 : position;
          if (videoFile.latest_media_location == null) videoFile.latest_media_location = { location };
          else videoFile.latest_media_location.location = location;
        }
      };

      const trackMediaLocation = (position: number) => {
        if (purchase_id != null) {
          const videoFile = playlist[player.getPlaylistIndex()];
          if (!videoFile) return;
          void trackMediaLocationChanged({
            urlRedirectId: url_redirect_id,
            productFileId: videoFile.external_id,
            purchaseId: purchase_id,
            location:
              videoFile.content_length != null && position > videoFile.content_length
                ? videoFile.content_length
                : position,
          });
        }
      };

      const throttledTrackMediaLocation = throttle(trackMediaLocation, LOCATION_TRACK_EVENT_DELAY_MS);

      // Recovery functions
      const reloadAndResume = () => {
        if (recovering || recoveryAttempts >= MAX_RECOVERY_ATTEMPTS) return;
        recovering = true;
        recoveryAttempts += 1;
        (window as any).__RECOVERY_ATTEMPTS__ = recoveryAttempts;
        (window as any).__EXPIRE_HLS__ = false;

        if (typeof (player as any).__armAutoResume === "function") {
          (player as any).__armAutoResume();
        }

        const currentItem = player.getPlaylistItem();
        const pos = lastKnownPosition;
        player.load([currentItem]);
        player.once("ready", () => {
          if (pos > 0) player.seek(pos);
          try {
            player.play(true);
          } catch (_) {}
          setTimeout(() => {
            try {
              player.play(true);
            } catch (_) {}
          }, 100);
          recovering = false;
        });
      };

      const debouncedReloadAndResume = debounce(reloadAndResume, RECOVERY_DEBOUNCE_MS);

      // Visibility change handler
      const handleVisibilityChange = () => {
        if (document.hidden) {
          hiddenAt = Date.now();
          return;
        }
        const t = hiddenAt;
        hiddenAt = null;
        const isTestExpiry = (window as any).__EXPIRE_HLS__ === true;
        const longPause = t && Date.now() - t >= VISIBILITY_RECOVERY_THRESHOLD_MS;
        if (isTestExpiry || longPause) {
          debouncedReloadAndResume();
          try {
            if (player && typeof player.play === "function") player.play(true);
          } catch (_) {}
          setTimeout(() => {
            try {
              if (player && typeof player.play === "function") player.play(true);
            } catch (_) {}
          }, 150);
        } else {
          try {
            if (player && typeof player.play === "function") player.play(true);
          } catch (_) {}
        }
      };

      document.addEventListener("visibilitychange", handleVisibilityChange);

      player.on("ready", () => {
        player.playlistItem(index_to_play);
      });

      player.on("seek", (ev: JWPlayerSeekEvt) => {
        trackMediaLocation(ev.offset);
        updateLocalMediaLocation(ev.offset, player.getDuration());
      });

      player.on("time", (ev: JWPlayerTimeEvt) => {
        throttledTrackMediaLocation(ev.position);
        updateLocalMediaLocation(ev.position, ev.duration);
        lastKnownPosition = ev.position || 0;
        lastKnownDuration = ev.duration || 0;
      });

      player.on("complete", () => {
        throttledTrackMediaLocation.cancel();
        const videoFile = playlist[player.getPlaylistIndex()];
        if (!videoFile) return;
        trackMediaLocation(videoFile.content_length === null ? player.getDuration() : videoFile.content_length);
        updateLocalMediaLocation(player.getDuration(), player.getDuration());
      });

      player.on("play", () => {
        const itemId = player.getPlaylistIndex();
        const videoFile = playlist[itemId];
        if (videoFile !== undefined && lastPlayedId !== itemId) {
          void createConsumptionEvent({
            eventType: "watch",
            urlRedirectId: url_redirect_id,
            productFileId: videoFile.external_id,
            purchaseId: purchase_id,
          });
          lastPlayedId = itemId;
          isInitialSeekDone = false;
        }
      });

      player.on("visualQuality", () => {
        if (isInitialSeekDone && lastPlayedId === player.getPlaylistIndex()) return;
        const videoFile = playlist[player.getPlaylistIndex()];
        if (
          videoFile?.latest_media_location != null &&
          videoFile.latest_media_location.location !== videoFile.content_length
        ) {
          player.seek(videoFile.latest_media_location.location);
        }
        isInitialSeekDone = true;
      });

      // Recovery event listeners
      player.on("error", (event: JWPlayerErrorEvt) => {
        const code = event.code || event.error?.code;
        if (code === 403 || code === 410) {
          debouncedReloadAndResume();
        }
      });

      player.on("buffer", () => {
        if (stallTimer) clearTimeout(stallTimer);
        stallTimer = setTimeout(() => {
          if (player.getState && player.getState() === "buffering") {
            debouncedReloadAndResume();
          }
        }, BUFFERING_STALL_TIMEOUT_MS);
      });

      player.on("playing", () => {
        if (stallTimer) {
          clearTimeout(stallTimer);
          stallTimer = null;
        }
      });

      player.on("idle", () => {
        const nearEnd = lastKnownDuration > 0 && lastKnownPosition >= lastKnownDuration - NEAR_END_THRESHOLD_S;
        if (!nearEnd) {
          debouncedReloadAndResume();
        }
      });

      // Cleanup function
      return () => {
        if (stallTimer) clearTimeout(stallTimer);
        debouncedReloadAndResume.cancel();
        throttledTrackMediaLocation.cancel();
        document.removeEventListener("visibilitychange", handleVisibilityChange);
        try {
          if (player && typeof player.remove === "function") player.remove();
        } catch (_) {}
      };
    };

    void createPlayer();
  });

  return (
    <>
      {should_show_transcoding_notice ? (
        <TranscodingNoticeModal transcodeOnFirstSale={transcode_on_first_sale} />
      ) : null}
      <div ref={containerRef} className="absolute h-full w-full"></div>
    </>
  );
};

export default register({ component: VideoStreamPlayer, propParser: createCast() });
