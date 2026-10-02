import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { CredentialsCard, credentialsMessage, whatsappLink, type Credentials } from "@/components/domain/credentials-card";

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

const base: Credentials = { name: "Aarav Patil", employeeCode: "EMP014", email: "aarav@company.com", password: "Abcd1234Efgh", phone: "9822012345" };

describe("the message sent to a new employee", () => {
  it("contains everything needed to sign in", () => {
    const text = credentialsMessage(base);
    expect(text).toContain("Hello Aarav Patil");
    expect(text).toContain("Employee ID: EMP014");
    expect(text).toContain("Email: aarav@company.com");
    expect(text).toContain("Password: Abcd1234Efgh");
    expect(text).toContain("change your password");
  });

  it("does not invent a password when the administrator chose it", () => {
    expect(credentialsMessage({ ...base, password: null })).toContain("the one your administrator gave you");
    expect(credentialsMessage({ ...base, password: null })).not.toContain("Abcd1234Efgh");
  });

  it("opens the person's own WhatsApp chat, adding India's code to a 10-digit number", () => {
    const link = whatsappLink(base);
    expect(link.startsWith("https://wa.me/919822012345?text=")).toBe(true);
    expect(decodeURIComponent(link)).toContain("Abcd1234Efgh");
  });

  it("keeps a number that already has its country code, and copes with spaces and dashes", () => {
    expect(whatsappLink({ ...base, phone: "+91 98220-12345" })).toContain("wa.me/919822012345?");
    expect(whatsappLink({ ...base, phone: "+1 415 555 0123" })).toContain("wa.me/14155550123?");
  });

  it("lets the administrator pick the contact when there is no number", () => {
    expect(whatsappLink({ ...base, phone: null }).startsWith("https://wa.me/?text=")).toBe(true);
  });
});

describe("the login details card", () => {
  it("hides the password until it is asked for", async () => {
    render(<CredentialsCard credentials={base} />);
    expect(screen.getByTestId("cred-employee-id")).toHaveTextContent("EMP014");
    expect(screen.getByTestId("cred-email")).toHaveTextContent("aarav@company.com");
    expect(screen.getByTestId("cred-password")).not.toHaveTextContent("Abcd1234Efgh");
    await userEvent.click(screen.getByRole("button", { name: "Show Password" }));
    expect(screen.getByTestId("cred-password")).toHaveTextContent("Abcd1234Efgh");
    await userEvent.click(screen.getByRole("button", { name: "Hide Password" }));
    expect(screen.getByTestId("cred-password")).not.toHaveTextContent("Abcd1234Efgh");
  });

  it("warns that the password is shown only once", () => {
    render(<CredentialsCard credentials={base} />);
    expect(screen.getByText(/shown only now/i)).toBeInTheDocument();
  });

  it("shows no password row when the administrator typed it themselves", () => {
    render(<CredentialsCard credentials={{ ...base, password: null }} />);
    expect(screen.queryByTestId("cred-password")).toBeNull();
    expect(screen.getByText(/the password is the one you typed/i)).toBeInTheDocument();
  });

  it("links to WhatsApp in a new tab without leaking the page", () => {
    render(<CredentialsCard credentials={base} />);
    const link = screen.getByRole("link", { name: /whatsapp/i });
    expect(link).toHaveAttribute("target", "_blank");
    expect(link).toHaveAttribute("rel", expect.stringContaining("noopener"));
  });
});
