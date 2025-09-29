import React, { useEffect, useRef, useState } from 'react';
import { jwplayer } from 'jwplayer';
import debounce from 'lodash/debounce';

interface VideoStreamPlayerProps {
  videoUrl: string;
  poster?: string;
  autoplay?: boolean;
}

export const VideoStreamPlayer: React.FC<VideoStreamPlayerProps> = ({
  videoUrl,
  poster,
  autoplay = false,
}) => {
  const playerRef = useRef<HTMLDivElement>(null);
  const [player, setPlayer] = useState<any>(null);
  const lastKnownPositionRef = useRef(0);
  const lastKnownDurationRef = useRef(0);
  const recoveryAttemptsRef = useRef(0);
  const recoveringRef = useRef(false);
  const hiddenAtRef = useRef<number | null>(null);
  const stallTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (playerRef.current) {
      const playerInstance = jwplayer(playerRef.current).setup({
        file: videoUrl,
        image: poster,
        autostart: autoplay,
        controls: true,
        responsive: true,
      });

      playerInstance.on('ready', () => {
        playerRef.current?.setAttribute('data-testid', 'jwplayer-ready');
        setPlayer(playerInstance);
      });

      playerInstance.on('time', (event: any) => {
        lastKnownPositionRef.current = event.position || 0;
        lastKnownDurationRef.current = event.duration || 0;
      });

      playerInstance.on('error', (event: any) => {
        if (event.code === 403 || event.code === 410) {
          debouncedReloadAndResume();
        }
      });

      playerInstance.on('buffer', () => {
        if (stallTimerRef.current) clearTimeout(stallTimerRef.current);
        stallTimerRef.current = setTimeout(() => {
          if (playerInstance.getState && playerInstance.getState() === 'buffering') {
            debouncedReloadAndResume();
          }
        }, 5000);
      });

      playerInstance.on('playing', () => {
        if (stallTimerRef.current) {
          clearTimeout(stallTimerRef.current);
          stallTimerRef.current = null;
        }
      });

      playerInstance.on('idle', () => {
        const pos = lastKnownPositionRef.current;
        const dur = lastKnownDurationRef.current;
        if (pos > 0 && dur > 0 && pos < dur - 10) {
          debouncedReloadAndResume();
        }
      });

      const handleVisibilityChange = () => {
        if (document.hidden) {
          hiddenAtRef.current = Date.now();
          return;
        }
        const t = hiddenAtRef.current;
        hiddenAtRef.current = null;
        if (t && Date.now() - t >= 300000) {
          debouncedReloadAndResume();
        }
      };

      document.addEventListener('visibilitychange', handleVisibilityChange);

      const reloadAndResume = () => {
        if (recoveringRef.current) return;
        if (recoveryAttemptsRef.current >= 3) return;
        recoveringRef.current = true;
        recoveryAttemptsRef.current += 1;
        (window as any).__RECOVERY_ATTEMPTS__ = recoveryAttemptsRef.current;
        const item = playerInstance.getPlaylistItem();
        const pos = lastKnownPositionRef.current;
        playerInstance.load([item]);
        playerInstance.once('ready', () => {
          if (pos > 0) playerInstance.seek(pos);
          playerInstance.play(true);
          recoveringRef.current = false;
        });
      };

      const debouncedReloadAndResume = debounce(reloadAndResume, 250);

      return () => {
        playerInstance.remove();
        document.removeEventListener('visibilitychange', handleVisibilityChange);
        if (stallTimerRef.current) clearTimeout(stallTimerRef.current);
        debouncedReloadAndResume.cancel();
      };
    }
  }, [videoUrl, poster]);

  return <div ref={playerRef} id="gumroad-player" />;
};
