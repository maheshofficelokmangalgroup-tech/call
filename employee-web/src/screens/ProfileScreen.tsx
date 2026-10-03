import { useState, type ReactNode } from "react";
import { Link } from "react-router";

import { Avatar } from "@/components/Avatar";
import { Button } from "@/components/Button";
import { Card } from "@/components/Card";
import { Tag } from "@/components/Chip";
import { Icon, type IconName } from "@/components/Icon";
import { Sheet } from "@/components/Sheet";
import { Text } from "@/components/Text";
import { APP_VERSION, useAuth, useSession } from "@/lib/auth";
import { titleCase } from "@/lib/format";
import { GREY_SOFT, AMBER_TEXT, colors } from "@/lib/theme";

function Row({ icon, label, value, to, tone = colors.green, toneSoft = colors.greenSoft }: { icon: IconName; label: string; value?: ReactNode; to?: string; tone?: string; toneSoft?: string }) {
  const body = (
    <>
      <span className="row-icon" style={{ backgroundColor: toneSoft }}>
        <Icon name={icon} size={20} color={tone} />
      </span>
      <span className="row-text">
        <Text variant="bodyMedium">{label}</Text>
        {value ? (
          <Text variant="small" color="muted">
            {value}
          </Text>
        ) : null}
      </span>
      {to ? <Icon name="chevron-right" size={18} color={colors.faint} /> : null}
    </>
  );
  return to ? (
    <Link to={to} className="profile-row">
      {body}
    </Link>
  ) : (
    <div className="profile-row">{body}</div>
  );
}

export function ProfileScreen() {
  const { employee, config } = useSession();
  const { signOut } = useAuth();
  const [confirmOut, setConfirmOut] = useState(false);
  const [signingOut, setSigningOut] = useState(false);

  return (
    <div className="page">
      <Text variant="title" as="h1" className="page-title">
        Profile
      </Text>

      <Card className="profile-head">
        <Avatar name={employee.full_name} size={68} />
        <div className="summary-text">
          <Text variant="h1" lines={1}>
            {employee.full_name}
          </Text>
          <Text variant="small" color="muted">
            {employee.employee_code} • {employee.email}
          </Text>
          <div className="tags">
            <Tag label={titleCase(employee.role)} icon="badge-check" />
            {employee.team_name ? <Tag label={employee.team_name} icon="users" color={colors.blue} background={colors.blueSoft} /> : null}
            <Tag label={`Target ${employee.daily_target}/day`} icon="target" color={AMBER_TEXT} background={colors.orangeSoft} />
          </div>
        </div>
      </Card>

      <Text variant="smallMedium" color="muted" className="group" as="h2">
        CALLING
      </Text>
      <Card padded={false} className="profile-list">
        <Row icon="smartphone" label="Calls from the web app" value="A call opens your device’s phone app. You come back here to record how it went." tone={colors.blue} toneSoft={colors.blueSoft} />
        <Row icon="mic-off" label="Recording" value={config.recording.enabled ? "Calls made in the phone app are recorded. Calls made from here are not." : "Calls made from here are not recorded."} tone={colors.muted} toneSoft={GREY_SOFT} />
      </Card>

      <Text variant="smallMedium" color="muted" className="group" as="h2">
        ACCOUNT
      </Text>
      <Card padded={false} className="profile-list">
        <Row icon="lock" label="Change password" to="/change-password" tone={colors.purple} toneSoft={colors.purpleSoft} />
        <Row icon="info" label="Web app version" value={APP_VERSION} tone={colors.muted} toneSoft={GREY_SOFT} />
      </Card>

      <div className="sign-out">
        <Button title="Sign out" icon="log-out" variant="outline" onClick={() => setConfirmOut(true)} testId="sign-out" />
      </div>

      <Sheet open={confirmOut} onClose={() => setConfirmOut(false)} title="Sign out?">
        <Text variant="body" color="muted" className="confirm-text">
          You will need your employee ID and password to sign in again.
        </Text>
        <div className="confirm-buttons">
          <Button title="Cancel" variant="outline" size="md" onClick={() => setConfirmOut(false)} />
          <Button
            title="Sign out"
            variant="danger"
            size="md"
            loading={signingOut}
            testId="sign-out-confirm"
            onClick={async () => {
              setSigningOut(true);
              await signOut();
            }}
          />
        </div>
      </Sheet>
    </div>
  );
}
