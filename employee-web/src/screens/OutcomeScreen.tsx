import { useEffect, useMemo, useRef, useState } from "react";
import { Navigate, useNavigate, useParams } from "react-router";
import { useQueryClient } from "@tanstack/react-query";

import { Avatar } from "@/components/Avatar";
import { Button } from "@/components/Button";
import { CallbackPicker } from "@/components/CallbackPicker";
import { Tag } from "@/components/Chip";
import { EmptyState } from "@/components/EmptyState";
import { Icon, type IconName } from "@/components/Icon";
import { Skeleton } from "@/components/Skeleton";
import { Text } from "@/components/Text";
import { TextField } from "@/components/TextField";
import { ApiError, errorMessage } from "@/lib/api";
import { allowedTalkSeconds, clearActiveCall, getActiveCall, submitOutcome } from "@/lib/callFlow";
import { useSession } from "@/lib/auth";
import { formatDuration, formatPhone } from "@/lib/format";
import { invalidateAfterCall, qk, useCall, useQueue } from "@/lib/queries";
import { DEFAULT_DISPOSITIONS, DISPOSITION_LOOK, OUTCOME_CODES, dispositionName } from "@/lib/status";
import { GREY_SOFT, colors } from "@/lib/theme";
import { formatDateTime, parseIso } from "@/lib/time";
import { toast } from "@/lib/toast";
import type { Disposition, DispositionCode } from "@/lib/types";

type Feedback = "supportive" | "neutral" | "negative";

const FEEDBACK: { key: Feedback; label: string; icon: IconName; tone: string; soft: string }[] = [
  { key: "supportive", label: "Supportive", icon: "thumbs-up", tone: colors.green, soft: colors.greenSoft },
  { key: "neutral", label: "Neutral", icon: "minus", tone: colors.blue, soft: colors.blueSoft },
  { key: "negative", label: "Negative", icon: "thumbs-down", tone: colors.red, soft: colors.redSoft },
];

/** A call that has been "open" for longer than this has no usable stop-watch time: the talk time starts empty. */
const MAX_DEFAULT_TALK_S = 2 * 3600;

function DispositionCard({ item, selected, onClick }: { item: Disposition; selected: boolean; onClick: () => void }) {
  const look = DISPOSITION_LOOK[item.code];
  return (
    <button
      type="button"
      className={["dcard", selected ? "dcard-on" : ""].filter(Boolean).join(" ")}
      style={{ backgroundColor: selected ? look.soft : colors.white, borderColor: selected ? look.tone : colors.border }}
      aria-pressed={selected}
      onClick={onClick}
      data-testid={`disposition-${item.code}`}
    >
      <span className="dcard-icon" style={{ backgroundColor: selected ? colors.white : look.soft }}>
        <Icon name={look.icon} size={22} color={look.tone} />
      </span>
      <Text variant="h3" lines={1} className="dcard-label">
        {dispositionName(item.code, item.label)}
      </Text>
      <Text variant="caption" color="muted" lines={2}>
        {look.hint}
      </Text>
      {selected ? (
        <span className="dcard-check" style={{ backgroundColor: look.tone }}>
          <Icon name="check" size={14} color={colors.white} strokeWidth={3} />
        </span>
      ) : null}
    </button>
  );
}

export function OutcomeScreen() {
  const callId = Number(useParams().id);
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { config } = useSession();
  const call = useCall(callId);
  const queue = useQueue();

  const dispositions = useMemo<Disposition[]>(() => {
    const list = config.dispositions?.length ? config.dispositions : [...DEFAULT_DISPOSITIONS];
    return list.filter((d) => OUTCOME_CODES.includes(d.code)).sort((a, b) => a.sort_order - b.sort_order);
  }, [config.dispositions]);

  const [selected, setSelected] = useState<DispositionCode | null>(null);
  const [feedback, setFeedback] = useState<Feedback | null>(null);
  const [notes, setNotes] = useState("");
  const [callbackAt, setCallbackAt] = useState<number | null>(null);
  const [talkInput, setTalkInput] = useState<{ min: string; sec: string } | null>(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState<{ nextName: string | null } | null>(null);
  // The in-call page records when the call ended (fixed once, so a repeated save reports the same moment). A call reached any
  // other way - the reminder on Home, an old link - has no stop-watch time: its talk time starts empty.
  const [flow] = useState(() => {
    const active = getActiveCall();
    return active && active.callId === callId && active.endedAt ? { endedAt: active.endedAt } : null;
  });
  const leaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(
    () => () => {
      if (leaveTimer.current) clearTimeout(leaveTimer.current);
    },
    [],
  );

  if (!Number.isFinite(callId)) return <Navigate to="/" replace />;
  const data = call.data;
  if (!data) {
    if (call.isError) return <EmptyState icon="alert" title="Could not open this call" message={errorMessage(call.error)} actionLabel="Go home" onAction={() => void navigate("/", { replace: true })} tone={colors.red} toneSoft={colors.redSoft} />;
    return (
      <div className="page">
        <Skeleton height={110} rounded={24} />
      </div>
    );
  }
  // the outcome is already recorded (another tab, or this one before a reload): show the call instead
  if (data.disposition && !saved && !saving) return <Navigate to={`/call/${callId}`} replace />;

  const startedAt = parseIso(data.started_at) ?? Date.now();
  const elapsed = flow ? Math.max(0, Math.floor((flow.endedAt - startedAt) / 1000)) : 0;
  const defaultTalk = flow && elapsed <= MAX_DEFAULT_TALK_S ? elapsed : 0;
  const talkSeconds = talkInput ? (parseInt(talkInput.min || "0", 10) || 0) * 60 + (parseInt(talkInput.sec || "0", 10) || 0) : defaultTalk;
  const shownTalk = talkInput ?? { min: String(Math.floor(defaultTalk / 60)), sec: String(defaultTalk % 60) };

  const connected = selected === "CONNECTED";
  const current = dispositions.find((d) => d.code === selected) ?? null;
  const needsTime = current?.requires_callback ?? false;
  const nextItem = queue.data?.items.find((i) => i.contact.id !== data.contact_id) ?? null;
  const canSave = Boolean(selected) && (!needsTime || callbackAt !== null) && !saving;
  const name = data.contact_name ?? formatPhone(data.phone_number);

  const save = async (goNext: boolean) => {
    if (!selected) return;
    if (needsTime && callbackAt === null) {
      toast.warning("Choose when to call back");
      return;
    }
    setSaving(true);
    try {
      // the feedback is saved with the call as the first line of its notes
      const feedbackLine = connected && feedback ? `Feedback: ${FEEDBACK.find((f) => f.key === feedback)?.label}` : null;
      const fullNotes = [feedbackLine, notes.trim()].filter(Boolean).join("\n");
      const talk = connected ? talkSeconds : 0;
      // without a stop-watch the call is taken to have ended when the talk time was over
      const endedAt = flow ? flow.endedAt : startedAt + talk * 1000;
      const updated = await submitOutcome(data, { code: selected, notes: fullNotes, callbackAt: needsTime ? callbackAt : null, talkSeconds: talk, endedAt });
      clearActiveCall();
      const next = goNext ? nextItem : null;
      setSaved({ nextName: next ? next.contact.name : null }); // before the cache changes, so the page never redirects away from "Saved!"
      queryClient.setQueryData(qk.call(callId), updated);
      invalidateAfterCall(queryClient, data.contact_id);
      leaveTimer.current = setTimeout(() => void navigate(next ? `/contact/${next.contact.id}` : "/", { replace: true }), 950);
    } catch (error) {
      if (error instanceof ApiError && error.code === "disposition_already_set") {
        toast.info("An outcome is already recorded for this call.");
        clearActiveCall();
        void navigate(`/call/${callId}`, { replace: true });
        return;
      }
      toast.error(errorMessage(error, "Could not save the outcome. Please try again."));
      setSaving(false);
    }
  };

  return (
    <div className="outcome" data-testid="outcome">
      <div className="outcome-scroll">
        <section className="summary">
          <Avatar name={name} size={56} />
          <div className="summary-text">
            <Text variant="small" color="muted">
              {flow ? "Call ended" : "Call waiting for an outcome"}
            </Text>
            <Text variant="h1" lines={1}>
              {name}
            </Text>
            <div className="tags">
              {flow ? <Tag label={`${formatDuration(elapsed)} on the clock`} icon="clock" /> : <Tag label={formatDateTime(startedAt)} icon="clock" />}
              <Tag label="Not recorded" icon="mic-off" color={colors.muted} background={GREY_SOFT} />
            </div>
            <Text variant="caption" color="muted" className="summary-note">
              Calls made from the web are not recorded.
            </Text>
          </div>
        </section>

        {connected ? (
          <>
            <Text variant="h2" className="heading">
              Feedback
            </Text>
            <div className="fb-row">
              {FEEDBACK.map((option) => {
                const on = feedback === option.key;
                return (
                  <button
                    key={option.key}
                    type="button"
                    className="fb-option"
                    style={on ? { backgroundColor: option.soft, borderColor: option.tone } : undefined}
                    aria-pressed={on}
                    onClick={() => setFeedback(on ? null : option.key)}
                    data-testid={`feedback-${option.key}`}
                  >
                    <Icon name={option.icon} size={22} color={on ? option.tone : colors.muted} />
                    <Text variant="smallMedium" color={on ? option.tone : colors.inkSoft} lines={1} className={on ? "semibold" : undefined}>
                      {option.label}
                    </Text>
                  </button>
                );
              })}
            </div>
          </>
        ) : null}

        <Text variant="h2" className={["heading", connected ? "heading-after" : ""].filter(Boolean).join(" ")}>
          How did it go?
        </Text>
        <div className="dgrid">
          {dispositions.map((item) => (
            <DispositionCard
              key={item.code}
              item={item}
              selected={selected === item.code}
              onClick={() => {
                setSelected(item.code);
                if (!item.requires_callback) setCallbackAt(null);
              }}
            />
          ))}
        </div>

        {needsTime ? (
          <div className="block">
            <Text variant="h2" className="block-title">
              When should you call back?
            </Text>
            <CallbackPicker value={callbackAt} onChange={setCallbackAt} />
          </div>
        ) : null}

        {connected ? (
          <div className="block">
            <Text variant="h2" className="block-title">
              Talk time
            </Text>
            <div className="talk" data-testid="talk-time">
              <label className="talk-field">
                <input
                  type="number"
                  inputMode="numeric"
                  min={0}
                  max={359}
                  value={shownTalk.min}
                  onChange={(event) => setTalkInput({ ...shownTalk, min: event.target.value })}
                  aria-label="Minutes"
                  data-testid="talk-min"
                />
                <Text variant="small" color="muted" as="span">
                  min
                </Text>
              </label>
              <label className="talk-field">
                <input
                  type="number"
                  inputMode="numeric"
                  min={0}
                  max={59}
                  value={shownTalk.sec}
                  onChange={(event) => setTalkInput({ ...shownTalk, sec: event.target.value })}
                  aria-label="Seconds"
                  data-testid="talk-sec"
                />
                <Text variant="small" color="muted" as="span">
                  sec
                </Text>
              </label>
            </div>
            <Text variant="caption" color="muted" className="talk-hint">
              {flow
                ? `Starts from the time on the clock. Change it to the time you actually spoke${allowedTalkSeconds(startedAt, flow.endedAt, talkSeconds) !== Math.floor(talkSeconds) ? " (it cannot be longer than the call)." : "."}`
                : "How long did you speak? Leave it at 0 if you are not sure."}
            </Text>
          </div>
        ) : null}

        <div className="block">
          <TextField label="Notes (optional)" value={notes} onChange={setNotes} placeholder="What was discussed? Anything to remember?" multiline rows={4} maxLength={2000} testId="outcome-notes" />
        </div>
      </div>

      <div className="outcome-bar">
        {needsTime && callbackAt ? (
          <Text variant="caption" color={colors.blue} align="center" className="bar-hint">
            Callback at {formatDateTime(callbackAt)}
          </Text>
        ) : null}
        <div className="bar-buttons">
          <Button title="Save" variant="outline" size="lg" onClick={() => void save(false)} disabled={!canSave} className="bar-save" testId="outcome-save" />
          <Button title={nextItem ? "Save & next" : "Save & finish"} iconRight="arrow-right" size="lg" onClick={() => void save(true)} loading={saving && !saved} disabled={!canSave} className="bar-next" testId="outcome-save-next" />
        </div>
      </div>

      {saved ? (
        <div className="saved-overlay" role="status" data-testid="saved">
          <span className="saved-check">
            <Icon name="check" size={56} color={colors.white} strokeWidth={3} />
          </span>
          <Text variant="title" align="center">
            Saved!
          </Text>
          <Text variant="body" color="muted" align="center">
            {saved.nextName ? `Next up: ${saved.nextName}` : "Great work. Keep it going."}
          </Text>
        </div>
      ) : null}
    </div>
  );
}
