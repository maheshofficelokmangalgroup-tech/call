"use client";

import { AlertCircle, Download, Loader2, Pause, Play, RotateCcw, RotateCw } from "lucide-react";
import * as React from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { errorMessage } from "@/lib/api";
import { issuePlaybackUrl } from "@/lib/queries";
import { cn, formatClock } from "@/lib/utils";

const SPEEDS = [1, 1.25, 1.5, 2, 0.75] as const;

/** Only one recording plays at a time: starting one pauses the one that was playing. */
let pauseCurrent: (() => void) | null = null;

interface AudioPlayerProps {
  recordingId: number;
  /** length known from the call record, shown until the file itself reports it */
  durationHint?: number | null;
  /** administrators may download the file; managers can only listen */
  canDownload?: boolean;
  className?: string;
}

/**
 * Plays one call recording. The signed link is requested only when somebody presses play (every request is logged by the
 * server), and it is renewed on its own if it expires while the recording is open.
 */
export function AudioPlayer({ recordingId, durationHint, canDownload = false, className }: AudioPlayerProps) {
  const audioRef = React.useRef<HTMLAudioElement>(null);
  const [src, setSrc] = React.useState<string | null>(null);
  const [loading, setLoading] = React.useState(false);
  const [playing, setPlaying] = React.useState(false);
  const [time, setTime] = React.useState(0);
  const [duration, setDuration] = React.useState(durationHint && durationHint > 0 ? durationHint : 0);
  const [speedIndex, setSpeedIndex] = React.useState(0);
  const [error, setError] = React.useState<string | null>(null);
  const [downloading, setDownloading] = React.useState(false);
  const autoplay = React.useRef(false);
  const resumeAt = React.useRef<number | null>(null);
  const renewals = React.useRef(0);

  const speed = SPEEDS[speedIndex]!;
  const hasSrc = src !== null;

  const stop = React.useCallback(() => {
    audioRef.current?.pause();
  }, []);

  // leaving the page (or opening another recording) must stop the sound
  React.useEffect(() => {
    return () => {
      stop();
      if (pauseCurrent === stop) pauseCurrent = null;
    };
  }, [stop]);

  const fetchLink = React.useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      return await issuePlaybackUrl(recordingId, "play");
    } catch (e) {
      setError(errorMessage(e, "The recording could not be opened."));
      return null;
    } finally {
      setLoading(false);
    }
  }, [recordingId]);

  async function toggle() {
    const audio = audioRef.current;
    if (loading) return;
    if (!hasSrc) {
      const link = await fetchLink();
      if (link) {
        autoplay.current = true;
        renewals.current = 0;
        setSrc(link);
      }
      return;
    }
    if (!audio) return;
    if (audio.paused) {
      try {
        await audio.play();
      } catch {
        setError("The browser blocked playback. Press play again.");
      }
    } else {
      audio.pause();
    }
  }

  function skip(seconds: number) {
    const audio = audioRef.current;
    if (!audio || !hasSrc) return;
    const limit = Number.isFinite(audio.duration) && audio.duration > 0 ? audio.duration : duration;
    audio.currentTime = Math.max(0, Math.min(limit || 0, audio.currentTime + seconds));
    setTime(audio.currentTime);
  }

  function seek(value: number) {
    const audio = audioRef.current;
    setTime(value);
    if (audio && hasSrc) audio.currentTime = value;
  }

  function cycleSpeed() {
    const next = (speedIndex + 1) % SPEEDS.length;
    setSpeedIndex(next);
    if (audioRef.current) audioRef.current.playbackRate = SPEEDS[next]!;
  }

  // the signed link has a short life; when the browser fails mid-recording, ask for a fresh one and carry on from the same second
  async function renew() {
    const audio = audioRef.current;
    if (renewals.current >= 2) {
      setError("The recording could not be played. It may have been removed, or the file is damaged.");
      setPlaying(false);
      return;
    }
    renewals.current += 1;
    resumeAt.current = audio?.currentTime ?? 0;
    autoplay.current = playing || (audio ? !audio.paused : false);
    const link = await fetchLink();
    if (link) setSrc(link);
  }

  async function download() {
    setDownloading(true);
    try {
      const link = await issuePlaybackUrl(recordingId, "download");
      const a = document.createElement("a");
      a.href = link;
      a.download = `recording-${recordingId}`;
      document.body.appendChild(a);
      a.click();
      a.remove();
    } catch (e) {
      toast.error(errorMessage(e, "Download failed."));
    } finally {
      setDownloading(false);
    }
  }

  const total = duration > 0 ? duration : 0;
  const percent = total > 0 ? Math.min(100, (time / total) * 100) : 0;

  return (
    <div className={cn("rounded-2xl border border-line bg-surface-2 p-4", className)} data-testid="audio-player">
      <audio
        ref={audioRef}
        src={src ?? undefined}
        preload="auto"
        onLoadedMetadata={(e) => {
          const audio = e.currentTarget;
          audio.playbackRate = speed;
          if (Number.isFinite(audio.duration) && audio.duration > 0) setDuration(audio.duration);
          if (resumeAt.current !== null) {
            audio.currentTime = resumeAt.current;
            resumeAt.current = null;
          }
          if (autoplay.current) {
            autoplay.current = false;
            audio.play().catch(() => setError("The browser blocked playback. Press play again."));
          }
        }}
        onDurationChange={(e) => {
          const d = e.currentTarget.duration;
          if (Number.isFinite(d) && d > 0) setDuration(d);
        }}
        onTimeUpdate={(e) => setTime(e.currentTarget.currentTime)}
        onPlay={() => {
          if (pauseCurrent && pauseCurrent !== stop) pauseCurrent();
          pauseCurrent = stop;
          setPlaying(true);
          setError(null);
        }}
        onPause={() => setPlaying(false)}
        onEnded={() => {
          setPlaying(false);
          setTime(0);
        }}
        onError={() => {
          if (hasSrc) void renew();
        }}
      />

      <div className="flex items-center gap-3.5">
        <button
          type="button"
          onClick={toggle}
          aria-label={playing ? "Pause recording" : "Play recording"}
          data-testid="audio-toggle"
          className="relative flex size-12 shrink-0 items-center justify-center rounded-full bg-brand text-white shadow-[0_8px_18px_-8px_var(--brand)] transition-transform hover:scale-105 active:scale-95 dark:text-[#04130a]"
        >
          {playing ? <span className="absolute inset-0 animate-pulse-ring rounded-full bg-brand/60" aria-hidden /> : null}
          {loading ? <Loader2 className="relative size-5 animate-spin" /> : playing ? <Pause className="relative size-5 fill-current" /> : <Play className="relative ml-0.5 size-5 fill-current" />}
        </button>

        <div className="min-w-0 flex-1">
          <input
            type="range"
            className="scrubber"
            min={0}
            max={total || 1}
            step={0.1}
            value={Math.min(time, total || 1)}
            disabled={!hasSrc || total === 0}
            aria-label="Seek"
            style={{ "--p": `${percent}%` } as React.CSSProperties}
            onChange={(e) => seek(Number(e.target.value))}
          />
          <div className="mt-0.5 flex items-center justify-between text-xs font-semibold text-muted tnum">
            <span>{formatClock(time)}</span>
            <span>{total > 0 ? formatClock(total) : "--:--"}</span>
          </div>
        </div>
      </div>

      <div className="mt-3 flex items-center justify-between gap-2">
        <div className="flex items-center gap-1">
          <Button variant="ghost" size="xs" onClick={() => skip(-10)} disabled={!hasSrc} aria-label="Back 10 seconds">
            <RotateCcw className="size-3.5" /> 10s
          </Button>
          <Button variant="ghost" size="xs" onClick={() => skip(10)} disabled={!hasSrc} aria-label="Forward 10 seconds">
            10s <RotateCw className="size-3.5" />
          </Button>
        </div>
        <div className="flex items-center gap-1.5">
          <Button variant="secondary" size="xs" onClick={cycleSpeed} aria-label={`Playback speed ${speed} times`} className="min-w-12 tnum">
            {speed}×
          </Button>
          {canDownload ? (
            <Button variant="secondary" size="xs" onClick={download} loading={downloading} aria-label="Download recording">
              <Download className="size-3.5" /> Download
            </Button>
          ) : null}
        </div>
      </div>

      {error ? (
        <p role="alert" className="mt-3 flex items-start gap-2 rounded-xl bg-danger-soft px-3 py-2 text-xs font-medium text-danger">
          <AlertCircle className="mt-px size-4 shrink-0" />
          <span>{error}</span>
        </p>
      ) : null}
    </div>
  );
}
