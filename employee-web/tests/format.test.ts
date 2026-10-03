import { describe, expect, it } from "vitest";

import { avatarColors, clamp, dialDigits, formatDialerInput, formatDuration, formatDurationWords, formatPhone, initials, pluralize, titleCase } from "@/lib/format";
import { passwordAcceptable, passwordStrength } from "@/lib/password";

describe("durations", () => {
  it("shows a clock", () => {
    expect(formatDuration(83)).toBe("01:23");
    expect(formatDuration(3725)).toBe("1:02:05");
    expect(formatDuration(-4)).toBe("00:00");
  });
  it("shows words", () => {
    expect(formatDurationWords(45)).toBe("45s");
    expect(formatDurationWords(83)).toBe("1m 23s");
    expect(formatDurationWords(120)).toBe("2m");
    expect(formatDurationWords(3700)).toBe("1h 1m");
    expect(formatDurationWords(3600)).toBe("1h");
  });
});

describe("phone numbers", () => {
  it("groups Indian and US numbers", () => {
    expect(formatPhone("+919876543210")).toBe("+91 98765 43210");
    expect(formatPhone("+14155550117")).toBe("+1 (415) 555-0117");
  });
  it("groups other numbers and bare digits", () => {
    expect(formatPhone("+4420791234567")).toBe("+44 207 912 345 67");
    expect(formatPhone("9876543210")).toBe("98765 43210");
    expect(formatPhone("")).toBe("");
  });
  it("formats what was typed on the keypad", () => {
    expect(formatDialerInput("4155550117")).toBe("41555 50117");
    expect(formatDialerInput("+919876543210")).toBe("+919876543210");
    expect(formatDialerInput("*#06#")).toBe("*#06#");
  });
  it("keeps digits and a plus for the dialer", () => {
    expect(dialDigits("+91 (987) 654-3210")).toBe("+919876543210");
  });
});

describe("names", () => {
  it("makes initials from Latin and Devanagari names", () => {
    expect(initials("Amit More")).toBe("AM");
    expect(initials("sneha")).toBe("S");
    expect(initials("रोहित मोरे")).toBe("रम");
    expect(initials("   ")).toBe("?");
  });
  it("gives the same colours to the same name", () => {
    expect(avatarColors("Amit More")).toEqual(avatarColors("Amit More"));
    expect(avatarColors("Amit More")).toHaveLength(2);
  });
  it("counts and capitalises", () => {
    expect(pluralize(1, "call")).toBe("1 call");
    expect(pluralize(3, "call")).toBe("3 calls");
    expect(titleCase("do_not_contact")).toBe("Do Not Contact");
    expect(clamp(12, 0, 10)).toBe(10);
    expect(clamp(-3, 0, 10)).toBe(0);
  });
});

describe("passwords", () => {
  it("scores strength", () => {
    expect(passwordStrength("")).toBe(0);
    expect(passwordStrength("abc")).toBe(1);
    expect(passwordStrength("Passw0rd-Test")).toBe(4);
  });
  it("applies the server's minimum", () => {
    expect(passwordAcceptable("abcdefg1", "old-pass-1")).toBe(true);
    expect(passwordAcceptable("short1", "old")).toBe(false);
    expect(passwordAcceptable("onlyletters", "old")).toBe(false);
    expect(passwordAcceptable("12345678", "old")).toBe(false);
    expect(passwordAcceptable("samePass12", "samePass12")).toBe(false);
  });
});
