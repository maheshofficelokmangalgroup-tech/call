import { useEffect, useState } from "react";
import { Link } from "react-router";
import { useQuery } from "@tanstack/react-query";

import { Avatar } from "@/components/Avatar";
import { Icon } from "@/components/Icon";
import { Text } from "@/components/Text";
import { isPlainDial, openDialer } from "@/lib/callFlow";
import { api } from "@/lib/endpoints";
import { formatDialerInput, formatPhone } from "@/lib/format";
import { contactStatusLook } from "@/lib/status";
import { colors } from "@/lib/theme";
import { useCallAction } from "@/lib/useCallAction";

const KEYS: { digit: string; letters: string }[][] = [
  [{ digit: "1", letters: "" }, { digit: "2", letters: "ABC" }, { digit: "3", letters: "DEF" }],
  [{ digit: "4", letters: "GHI" }, { digit: "5", letters: "JKL" }, { digit: "6", letters: "MNO" }],
  [{ digit: "7", letters: "PQRS" }, { digit: "8", letters: "TUV" }, { digit: "9", letters: "WXYZ" }],
  [{ digit: "*", letters: "" }, { digit: "0", letters: "+" }, { digit: "#", letters: "" }],
];

const MAX_LENGTH = 16;

export function DialerScreen() {
  const call = useCallAction();
  const [value, setValue] = useState("");

  // a typed number that belongs to one of the employee's contacts shows that contact
  const digits = value.replace(/\D/g, "");
  const lookup = useQuery({
    queryKey: ["dial-match", digits],
    queryFn: async ({ signal }) => (await api.contacts({ q: digits, page_size: 5 }, signal)).items.find((c) => c.phone.replace(/\D/g, "").endsWith(digits)) ?? null,
    enabled: digits.length >= 6,
    staleTime: 60_000,
  });
  const match = digits.length >= 6 ? (lookup.data ?? null) : null;

  const plain = isPlainDial(value);
  const callable = digits.length >= 5 || plain;
  const size = value.length <= 10 ? 38 : value.length <= 13 ? 32 : 26;

  const press = (digit: string) => setValue((v) => (v.length >= MAX_LENGTH ? v : v + digit));

  const placeCall = () => {
    if (!callable) return;
    if (plain) {
      openDialer(value); // emergency numbers and keypad codes are dialled by the phone itself, never as a CRM call
      return;
    }
    void call({ contactId: match?.id ?? null, contactName: match?.name ?? null, phone: value.replace(/[^\d+]/g, "") });
  };

  // the computer's keyboard works too
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target && /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName)) return;
      if (event.ctrlKey || event.metaKey || event.altKey) return;
      if (/^[0-9*#+]$/.test(event.key)) setValue((v) => (v.length >= MAX_LENGTH ? v : v + event.key));
      else if (event.key === "Backspace") setValue((v) => v.slice(0, -1));
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);

  return (
    <div className="page dialer">
      <Text variant="title" as="h1" className="page-title">
        Dial
      </Text>

      <div className="dial-display">
        <Text variant="display" align="center" className="dial-number" style={{ fontSize: size, lineHeight: `${size + 10}px` }} data-testid="dialer-number">
          {value ? formatDialerInput(value) : " "}
        </Text>
        <div className="dial-match">
          {match ? (
            <Link to={`/contact/${match.id}`} className="match">
              <Avatar name={match.name} size={34} />
              <span className="match-text">
                <Text variant="bodyMedium" lines={1}>
                  {match.name}
                </Text>
                <Text variant="caption" color={contactStatusLook(match.status).color}>
                  {contactStatusLook(match.status).label} • {formatPhone(match.phone)}
                </Text>
              </span>
              <Icon name="chevron-right" size={18} color={colors.muted} />
            </Link>
          ) : plain ? (
            <Text variant="smallMedium" color={colors.red} align="center">
              Dialled by your phone, not logged as a CRM call
            </Text>
          ) : value.length >= 5 ? (
            <Text variant="small" color="muted" align="center">
              Not in your contacts
            </Text>
          ) : null}
        </div>
      </div>

      <div className="pad">
        {KEYS.map((row, r) => (
          <div key={r} className="pad-row">
            {row.map((key) => (
              <button key={key.digit} type="button" className="key" onClick={() => press(key.digit)} aria-label={key.digit === "*" ? "star" : key.digit === "#" ? "hash" : key.digit} data-testid={`key-${key.digit}`}>
                <span className="key-digit">{key.digit}</span>
                {key.letters ? <span className="key-letters">{key.letters}</span> : null}
              </button>
            ))}
          </div>
        ))}
      </div>

      <div className="dial-bottom">
        <span className="dial-side" />
        <button type="button" className={["dial-call", !callable ? "dial-call-off" : ""].filter(Boolean).join(" ")} onClick={placeCall} disabled={!callable} aria-label="Call" data-testid="dialer-call">
          <Icon name="phone" size={32} color={colors.white} />
        </button>
        <span className="dial-side">
          {value ? (
            <button type="button" className="icon-btn flat" onClick={() => setValue((v) => v.slice(0, -1))} onDoubleClick={() => setValue("")} aria-label="Delete the last digit" data-testid="dialer-backspace">
              <Icon name="backspace" size={28} color={colors.inkSoft} />
            </button>
          ) : null}
        </span>
      </div>
    </div>
  );
}
