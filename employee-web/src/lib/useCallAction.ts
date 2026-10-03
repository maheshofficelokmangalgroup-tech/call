import { useCallback, useRef } from "react";
import { useNavigate } from "react-router";

import { callErrorMessage, getActiveCall, openDialer, placeCall, type StartCallInput } from "./callFlow";
import { toast } from "./toast";

/**
 * Returns a function that starts a call: registers the attempt, opens the in-call page and hands the number to the device's
 * phone app. Only one call can be in progress; pressing Call again opens the one that is.
 */
export function useCallAction(): (input: StartCallInput) => Promise<void> {
  const navigate = useNavigate();
  const busy = useRef(false);
  return useCallback(
    async (input: StartCallInput) => {
      if (busy.current) return;
      const existing = getActiveCall();
      if (existing) {
        toast.info("Finish the call you are on first.");
        void navigate(existing.endedAt ? `/outcome/${existing.callId}` : `/incall/${existing.callId}`);
        return;
      }
      busy.current = true;
      try {
        const active = await placeCall(input);
        void navigate(`/incall/${active.callId}`);
        openDialer(active.phone);
      } catch (error) {
        toast.error(callErrorMessage(error));
      } finally {
        busy.current = false;
      }
    },
    [navigate],
  );
}
