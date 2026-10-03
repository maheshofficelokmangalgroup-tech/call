import { useState } from "react";
import { Navigate, useSearchParams } from "react-router";

import { Button } from "@/components/Button";
import { Icon } from "@/components/Icon";
import { Splash } from "@/components/Splash";
import { Text } from "@/components/Text";
import { TextField } from "@/components/TextField";
import { ApiError, NetworkError } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { colors } from "@/lib/theme";

export function loginErrorMessage(error: unknown): string {
  if (error instanceof NetworkError) return "Cannot reach the server. Check your internet connection and try again.";
  if (error instanceof ApiError) {
    switch (error.code) {
      case "invalid_credentials":
        return "Incorrect employee ID/email or password.";
      case "account_disabled":
        return "Your account has been deactivated. Contact your administrator.";
      case "rate_limited":
        return `Too many attempts. Try again in ${error.retryAfter ?? 60} seconds.`;
      default:
        return error.message;
    }
  }
  return "Something went wrong. Please try again.";
}

/** Only a path on this site: a sign-in link must never send somebody to another address. */
export function safeNext(value: string | null): string {
  return value && value.startsWith("/") && !value.startsWith("//") && !value.startsWith("/login") ? value : "/";
}

export function LoginScreen() {
  const { state, signIn } = useAuth();
  const [params] = useSearchParams();
  const [identifier, setIdentifier] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (state.status === "signedIn") return <Navigate to={safeNext(params.get("next"))} replace />;
  if (state.status === "loading") return <Splash />; // a saved session is being checked: no flash of the sign-in form
  const notice = state.status === "signedOut" ? state.notice : undefined;

  const submit = async () => {
    if (loading) return;
    if (!identifier.trim() || !password) {
      setError("Enter your employee ID (or email) and password.");
      return;
    }
    setError(null);
    setLoading(true);
    try {
      await signIn(identifier, password);
    } catch (e) {
      setError(loginErrorMessage(e));
      setLoading(false);
    }
  };

  return (
    <div className="login">
      <div className="login-hero">
        <span className="bubble bubble-a" />
        <span className="bubble bubble-b" />
        <span className="login-logo">
          <Icon name="phone-call" size={38} color={colors.green} />
        </span>
        <Text variant="display" as="h1" className="login-title">
          Let’s start
          <br />
          calling
        </Text>
        <Text variant="body" color="inkSoft">
          Sign in to see today’s contacts.
        </Text>
      </div>

      <form
        className="login-sheet"
        onSubmit={(event) => {
          event.preventDefault();
          void submit();
        }}
        noValidate
      >
        {notice ? (
          <div className="notice">
            <Icon name="info" size={18} color={colors.blue} />
            <Text variant="smallMedium" color={colors.blue}>
              {notice}
            </Text>
          </div>
        ) : null}
        <TextField
          label="Employee ID or email"
          icon="user"
          value={identifier}
          onChange={(value) => {
            setIdentifier(value);
            if (error) setError(null);
          }}
          autoComplete="username"
          inputMode="email"
          placeholder="EMP001 or name@company.com"
          autoFocus
          testId="login-identifier"
          name="identifier"
        />
        <TextField
          label="Password"
          icon="lock"
          secure
          value={password}
          onChange={(value) => {
            setPassword(value);
            if (error) setError(null);
          }}
          autoComplete="current-password"
          placeholder="Your password"
          testId="login-password"
          name="password"
        />
        {error ? (
          <div className="error-box" role="alert">
            <Icon name="alert" size={18} color={colors.red} />
            <Text variant="smallMedium" color={colors.red} data-testid="login-error">
              {error}
            </Text>
          </div>
        ) : null}
        <Button title="Sign in" type="submit" loading={loading} iconRight="arrow-right" className="login-submit" testId="login-submit" />
        <Text variant="small" color="muted" align="center" className="login-foot">
          Forgot your password? Ask your administrator to reset it.
        </Text>
        <Text variant="caption" color="faint" align="center">
          This is the browser version of the phone app. Calls open your device’s phone app.
        </Text>
      </form>
    </div>
  );
}
