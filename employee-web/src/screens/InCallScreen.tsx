import { useEffect, useState } from "react";
import { Navigate, useNavigate, useParams } from "react-router";

import { Avatar } from "@/components/Avatar";
import { Button } from "@/components/Button";
import { EmptyState } from "@/components/EmptyState";
import { Icon } from "@/components/Icon";
import { Text } from "@/components/Text";
import { errorMessage } from "@/lib/api";
import { cancelCall, clearActiveCall, getActiveCall, markCallEnded, setActiveCall, telHref, type ActiveCall } from "@/lib/callFlow";
import { copyText } from "@/lib/clipboard";
import { formatDuration, formatPhone } from "@/lib/format";
import { useCall } from "@/lib/queries";
import { colors } from "@/lib/theme";
import { parseIso } from "@/lib/time";
import { toast } from "@/lib/toast";
import { useNow } from "@/lib/useNow";

/**
 * The call in progress. The call itself happens in the device's phone app; this page keeps the time and waits for the employee
 * to say the call is over, then moves on to the outcome.
 */
export function InCallScreen() {
  const callId = Number(useParams().id);
  const navigate = useNavigate();
  const call = useCall(callId);
  const now = useNow(1000);
  const [active, setActive] = useState<ActiveCall | null>(() => {
    const saved = getActiveCall();
    return saved && saved.callId === callId ? saved : null;
  });
  const [cancelling, setCancelling] = useState(false);

  // Opened without a saved record (another browser, cleared storage): rebuild it from the server so the call can still be finished.
  const serverCall = call.data;
  useEffect(() => {
    if (active || !serverCall || serverCall.disposition || serverCall.status === "failed") return;
    const rebuilt: ActiveCall = {
      callId,
      clientCallId: serverCall.client_call_id,
      contactId: serverCall.contact_id,
      name: serverCall.contact_name ?? serverCall.phone_number,
      phone: serverCall.phone_number,
      startedAt: parseIso(serverCall.started_at) ?? Date.now(),
      endedAt: null,
    };
    setActiveCall(rebuilt);
    setActive(rebuilt);
  }, [active, serverCall, callId]);

  if (!Number.isFinite(callId)) return <Navigate to="/" replace />;
  // finished somewhere else (another tab or device): nothing left to do here
  if (serverCall && (serverCall.disposition || serverCall.status === "failed")) {
    if (getActiveCall()?.callId === callId) clearActiveCall();
    return <Navigate to={`/call/${callId}`} replace />;
  }
  if (!active) {
    if (call.isError) return <EmptyState icon="alert" title="Could not open this call" message={errorMessage(call.error)} actionLabel="Go home" onAction={() => void navigate("/", { replace: true })} tone={colors.red} toneSoft={colors.redSoft} />;
    return (
      <div className="splash" role="status" aria-label="Loading">
        <span className="spinner spinner-dark" />
      </div>
    );
  }

  const end = () => {
    markCallEnded(active);
    void navigate(`/outcome/${callId}`, { replace: true });
  };

  const cancel = async () => {
    setCancelling(true);
    try {
      await cancelCall(active);
      toast.info("Call cancelled");
      void navigate("/", { replace: true });
    } catch (error) {
      toast.error(errorMessage(error));
      setCancelling(false);
    }
  };

  const copy = async () => {
    if (await copyText(active.phone)) toast.success("Number copied");
    else toast.error("Could not copy the number");
  };

  return (
    <div className="incall" data-testid="incall">
      <Text variant="small" color="rgba(255,255,255,0.8)" align="center">
        Calling with your phone app
      </Text>
      <div className="incall-who">
        <Avatar name={active.name} size={96} />
        <Text variant="title" color={colors.white} align="center" lines={2} as="h1">
          {active.name}
        </Text>
        <Text variant="h3" color="rgba(255,255,255,0.9)" className="selectable">
          {formatPhone(active.phone)}
        </Text>
        <Text variant="display" color={colors.white} className="incall-timer" data-testid="call-timer">
          {formatDuration((now - active.startedAt) / 1000)}
        </Text>
        <Text variant="small" color="rgba(255,255,255,0.8)" align="center" className="incall-hint">
          Your phone’s dialer should have opened. When the call is over, come back here and tap “Call ended”.
        </Text>
      </div>

      <div className="incall-actions">
        <a className="btn btn-white btn-md" href={telHref(active.phone)} data-testid="open-dialer">
          <Icon name="phone" size={20} />
          <span className="btn-label">Open dialer again</span>
        </a>
        <Button title="Copy number" icon="copy" variant="white" size="md" onClick={() => void copy()} />
      </div>

      <div className="incall-end">
        <Button title="Call ended" iconRight="arrow-right" variant="accent" size="lg" onClick={end} testId="call-ended" />
        <button type="button" className="link-btn light" onClick={() => void cancel()} disabled={cancelling} data-testid="call-cancel">
          I did not place the call
        </button>
      </div>
    </div>
  );
}
