"use client";

import { useRef, useState } from "react";

const BACKGROUND_MUSIC_URL = "/audio/background.mp3";
const DEFAULT_VOLUME = 0.28;

type PlaybackState = "paused" | "loading" | "playing" | "unavailable";

export function BackgroundMusic() {
  const audioRef = useRef<HTMLAudioElement>(null);
  const [state, setState] = useState<PlaybackState>("paused");

  async function togglePlayback() {
    const audio = audioRef.current;
    if (!audio) return;

    if (!audio.paused) {
      audio.pause();
      setState("paused");
      return;
    }

    setState("loading");
    audio.volume = DEFAULT_VOLUME;
    try {
      await audio.play();
      setState("playing");
    } catch {
      setState("unavailable");
    }
  }

  const playing = state === "playing";
  const label = playing
    ? "Tắt nhạc nền"
    : state === "loading"
      ? "Đang mở nhạc"
      : state === "unavailable"
        ? "Chưa có nhạc"
        : "Bật nhạc nền";

  return (
    <div className="background-music-control">
      <audio
        loop
        onError={() => setState("unavailable")}
        onPause={() => setState((current) => current === "unavailable" ? current : "paused")}
        playsInline
        preload="none"
        ref={audioRef}
        src={BACKGROUND_MUSIC_URL}
      />
      {state === "unavailable" && (
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
