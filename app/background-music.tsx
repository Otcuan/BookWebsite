"use client";

import { useCallback, useEffect, useRef, useState } from "react";

const BACKGROUND_MUSIC_URL = "/audio/background.mp3";
const DEFAULT_VOLUME = 0.28;
const MUSIC_PREFERENCE_KEY = "tu-sach:background-music:v1";

type PlaybackState = "paused" | "loading" | "playing" | "blocked" | "missing";

export function BackgroundMusic() {
  const audioRef = useRef<HTMLAudioElement>(null);
  const [state, setState] = useState<PlaybackState>("paused");

  const attemptPlayback = useCallback(async () => {
    const audio = audioRef.current;
    if (!audio) return;

    setState("loading");
    audio.volume = DEFAULT_VOLUME;
    try {
      await audio.play();
      setState("playing");
    } catch (error) {
      setState(isAutoplayBlocked(error) ? "blocked" : "missing");
    }
  }, []);

  useEffect(() => {
    if (!readMusicEnabledPreference()) return;

    let active = true;
    queueMicrotask(() => {
      if (active) void attemptPlayback();
    });
    return () => {
      active = false;
    };
  }, [attemptPlayback]);

  async function togglePlayback() {
    const audio = audioRef.current;
    if (!audio) return;

    if (!audio.paused) {
      audio.pause();
      writeMusicEnabledPreference(false);
      setState("paused");
      return;
    }

    writeMusicEnabledPreference(true);
    await attemptPlayback();
  }

  const playing = state === "playing";
  const label = playing
    ? "Tắt nhạc nền"
    : state === "loading"
      ? "Đang mở nhạc"
      : state === "blocked"
        ? "Chạm để bật nhạc"
        : state === "missing"
          ? "Chưa có nhạc"
          : "Bật nhạc nền";

  return (
    <div className="background-music-control">
      <audio
        loop
        onError={() => setState("missing")}
        onPause={() => setState((current) =>
          current === "missing" || current === "blocked" ? current : "paused"
        )}
        onPlay={() => setState("playing")}
        playsInline
        preload="metadata"
        ref={audioRef}
        src={BACKGROUND_MUSIC_URL}
      />
      {state === "blocked" && (
        <span className="background-music-notice" role="status">
          Trình duyệt cần bạn chạm một lần để phát nhạc.
        </span>
      )}
      {state === "missing" && (
        <span className="background-music-notice" role="status">
          Thêm file public/audio/background.mp3
        </span>
      )}
      <button
        aria-label={label}
        aria-pressed={playing}
        disabled={state === "loading"}
        onClick={togglePlayback}
        title={label}
        type="button"
      >
        <span aria-hidden="true">{playing ? "♫" : "♪"}</span>
        <span>{label}</span>
      </button>
    </div>
  );
}

function readMusicEnabledPreference(): boolean {
  try {
    return localStorage.getItem(MUSIC_PREFERENCE_KEY) !== "off";
  } catch {
    return true;
  }
}

function writeMusicEnabledPreference(enabled: boolean) {
  try {
    localStorage.setItem(MUSIC_PREFERENCE_KEY, enabled ? "on" : "off");
  } catch {
    // Playback still works for this visit when browser storage is unavailable.
  }
}

function isAutoplayBlocked(error: unknown): boolean {
  return error instanceof DOMException && error.name === "NotAllowedError";
}
