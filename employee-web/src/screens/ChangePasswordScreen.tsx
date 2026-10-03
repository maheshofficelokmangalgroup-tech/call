import { useMemo, useState } from "react";
import { useNavigate } from "react-router";

import { Button } from "@/components/Button";
import { Icon } from "@/components/Icon";
import { ScreenHeader } from "@/components/ScreenHeader";
import { Text } from "@/components/Text";
import { TextField } from "@/components/TextField";
import { ApiError, NetworkError } from "@/lib/api";
import { useAuth, useSession } from "@/lib/auth";
import { api } from "@/lib/endpoints";
import { passwordAcceptable, passwordStrength } from "@/lib/password";
import { colors } from "@/lib/theme";
import { toast } from "@/lib/toast";

const LEVELS = ["", "Weak", "Fair", "Good", "Strong"];
const LEVEL_COLORS = ["#E4E7EB", colors.red, colors.orange, "#65A30D", colors.green];

function StrengthBar({ score }: { score: number }) {
  return (
    <div className="strength">
      <div className="strength-track">
        <div className="strength-fill" style={{ width: `${(score / 4) * 100}%`, backgroundColor: LEVEL_COLORS[score] }} />
      </div>
      <Text variant="caption" color="muted">
        {LEVELS[score]}
      </Text>
    </div>
  );
}

export function ChangePasswordScreen() {
  const navigate = useNavigate();
  const { employee } = useSession();
  const { signOut, markPasswordChanged } = useAuth();
  const forced = employee.must_change_password;
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const score = useMemo(() => passwordStrength(next), [next]);
  const mismatch = confirm.length > 0 && confirm !== next;
  const valid = current.length > 0 && passwordAcceptable(next, current) && next === confirm;

  const submit = async () => {
    if (!valid || loading) return;
    setLoading(true);
    setError(null);
    try {
      await api.changePassword(current, next);
      toast.success("Password changed");
      markPasswordChanged();
      void navigate("/", { replace: true });
    } catch (e) {
      if (e instanceof NetworkError) setError("Cannot reach the server. Check your connection.");
      else if (e instanceof ApiError) setError(e.code === "invalid_credentials" ? "Your current password is incorrect." : e.message);
      else setError("Something went wrong. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="page">
      {forced ? (
        <div className="forced-head">
          <span className="forced-lock">
            <Icon name="lock" size={30} color={colors.green} />
          </span>
          <Text variant="title" align="center" as="h1">
            Choose a new password
          </Text>
          <Text variant="body" color="inkSoft" align="center">
            Hi {employee.full_name.split(" ")[0]}, your administrator gave you a temporary password. Set your own to continue.
          </Text>
        </div>
      ) : (
        <ScreenHeader title="Change password" back />
      )}
      <form
        className="form"
        onSubmit={(event) => {
          event.preventDefault();
          void submit();
        }}
      >
        <TextField label="Current password" icon="lock" secure value={current} onChange={setCurrent} autoComplete="current-password" placeholder="Current password" testId="pw-current" name="current" />
        <TextField label="New password" icon="lock" secure value={next} onChange={setNext} autoComplete="new-password" placeholder="At least 8 characters, letters and numbers" testId="pw-new" name="new" />
        <StrengthBar score={score} />
        <div className="gap" />
        <TextField
          label="Confirm new password"
          icon="lock"
          secure
          value={confirm}
          onChange={setConfirm}
          autoComplete="new-password"
          placeholder="Repeat the new password"
          error={mismatch ? "Passwords do not match" : null}
          testId="pw-confirm"
          name="confirm"
        />
        {error ? (
          <div className="error-box" role="alert">
            <Icon name="alert" size={18} color={colors.red} />
            <Text variant="smallMedium" color={colors.red}>
              {error}
            </Text>
          </div>
        ) : null}
        <Button title="Update password" icon="check" type="submit" loading={loading} disabled={!valid} className="form-submit" testId="pw-submit" />
        {forced ? <Button title="Sign out" variant="outline" size="md" onClick={() => void signOut()} className="form-secondary" /> : null}
      </form>
    </div>
  );
}
