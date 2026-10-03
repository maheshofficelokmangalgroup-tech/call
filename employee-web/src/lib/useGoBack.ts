import { useCallback } from "react";
import { useNavigate } from "react-router";

/** "Back" goes to the page before this one, or to home when this page was opened directly (a link, a bookmark, a new tab). */
export function useGoBack(): () => void {
  const navigate = useNavigate();
  return useCallback(() => {
    const index = (window.history.state as { idx?: number } | null)?.idx ?? 0;
    if (index > 0) void navigate(-1);
    else void navigate("/", { replace: true });
  }, [navigate]);
}
