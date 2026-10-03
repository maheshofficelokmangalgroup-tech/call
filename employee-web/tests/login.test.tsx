import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ApiError, NetworkError } from "@/lib/api";
import { LoginScreen, loginErrorMessage, safeNext } from "@/screens/LoginScreen";

const signIn = vi.hoisted(() => vi.fn());
const auth = vi.hoisted(() => ({ state: { status: "signedOut" } as { status: string; notice?: string } }));
vi.mock("@/lib/auth", () => ({ useAuth: () => ({ state: auth.state, signIn }) }));

function show() {
  render(
    <MemoryRouter initialEntries={["/login"]}>
      <LoginScreen />
    </MemoryRouter>,
  );
  return userEvent.setup();
}

beforeEach(() => {
  vi.clearAllMocks();
  auth.state = { status: "signedOut" };
});

describe("sign-in page", () => {
  it("asks for both fields before calling the server", async () => {
    const user = show();
    await user.click(screen.getByTestId("login-submit"));
    expect(screen.getByTestId("login-error")).toHaveTextContent("Enter your employee ID (or email) and password.");
    expect(signIn).not.toHaveBeenCalled();
  });

  it("signs in with what was typed (and trims the ID)", async () => {
    signIn.mockResolvedValue(undefined);
    const user = show();
    await user.type(screen.getByTestId("login-identifier"), "EMP001");
    await user.type(screen.getByTestId("login-password"), "Employee@123{Enter}");
    expect(signIn).toHaveBeenCalledWith("EMP001", "Employee@123");
  });

  it("shows the server's verdict on a wrong password and lets the person try again", async () => {
    signIn.mockRejectedValueOnce(new ApiError(401, "invalid_credentials", "Incorrect"));
    const user = show();
    await user.type(screen.getByTestId("login-identifier"), "EMP001");
    await user.type(screen.getByTestId("login-password"), "wrong");
    await user.click(screen.getByTestId("login-submit"));
    expect(await screen.findByTestId("login-error")).toHaveTextContent("Incorrect employee ID/email or password.");
    // typing clears the message
    await user.type(screen.getByTestId("login-password"), "x");
    expect(screen.queryByTestId("login-error")).toBeNull();
  });

  it("hides the password until the eye is pressed", async () => {
    const user = show();
    const box = screen.getByTestId("login-password");
    expect(box).toHaveAttribute("type", "password");
    await user.click(screen.getByRole("button", { name: "Show password" }));
    expect(box).toHaveAttribute("type", "text");
  });

  it("shows why the session ended", () => {
    auth.state = { status: "signedOut", notice: "Your session has ended. Please sign in again." };
    show();
    expect(screen.getByText("Your session has ended. Please sign in again.")).toBeInTheDocument();
  });
});

describe("messages", () => {
  it("explains each failure in plain words", () => {
    expect(loginErrorMessage(new NetworkError())).toMatch(/Cannot reach the server/);
    expect(loginErrorMessage(new ApiError(403, "account_disabled", "x"))).toMatch(/deactivated/);
    expect(loginErrorMessage(new ApiError(429, "rate_limited", "x", undefined, 30))).toBe("Too many attempts. Try again in 30 seconds.");
    expect(loginErrorMessage(new ApiError(400, "other", "The server's own words"))).toBe("The server's own words");
    expect(loginErrorMessage(new Error("?"))).toBe("Something went wrong. Please try again.");
  });
});

describe("where to go after signing in", () => {
  it("only follows paths on this site", () => {
    expect(safeNext("/history?filter=connected")).toBe("/history?filter=connected");
    expect(safeNext("/contact/12")).toBe("/contact/12");
    expect(safeNext(null)).toBe("/");
    expect(safeNext("")).toBe("/");
    expect(safeNext("https://evil.example/phish")).toBe("/");
    expect(safeNext("//evil.example/phish")).toBe("/");
    expect(safeNext("/login")).toBe("/");
    expect(safeNext("javascript:alert(1)")).toBe("/");
  });
});
