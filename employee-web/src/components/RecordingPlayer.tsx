import { useState } from "react";

import { errorMessage, resolveMediaUrl } from "@/lib/api";
import { api } from "@/lib/endpoints";
import { colors } from "@/lib/theme";

import { Button } from "./Button";
import { Text } from "./Text";

/** Plays a recording. The link the server hands out is short-lived, so it is only requested when "Play" is pressed. */
export function RecordingPlayer({ recordingId }: { recordingId: number }) {
  const [url, setUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      setUrl(resolveMediaUrl((await api.playbackUrl(recordingId)).url));
    } catch (e) {
      setError(errorMessage(e, "The recording could not be loaded."));
    } finally {
      setLoading(false);
    }
  };

  if (url) {
    return (
      <audio
        className="audio"
        controls
        autoPlay
        src={url}
        onError={() => {
          setUrl(null); // the link expired: ask for a fresh one on the next press
          setError("The recording stopped loading. Press play to try again.");
        }}
        data-testid="recording-audio"
      />
    );
  }
  return (
    <div className="stack">
      <Button title="Play recording" icon="play" size="md" variant="soft" loading={loading} onClick={() => void load()} testId="recording-play" />
      {error ? (
        <Text variant="small" color={colors.red}>
          {error}
        </Text>
      ) : null}
    </div>
  );
}
