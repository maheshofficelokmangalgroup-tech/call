import { describe, expect, it } from "vitest";

import { SAMPLE_CSV, credentialsSheet, parseEmployeeSheet } from "@/lib/employee-import";
import type { Team } from "@/lib/types";

const teams = [
  { id: 1, name: "Sales Team A", description: null, is_active: true, member_count: 5 },
  { id: 2, name: "Sales Team B", description: null, is_active: true, member_count: 5 },
] as Team[];

const parse = (csv: string) => parseEmployeeSheet(csv, teams, 50);

describe("employee sheet", () => {
  it("reads the sample file without a single problem", () => {
    const sheet = parse(SAMPLE_CSV);
    expect(sheet.missing).toEqual([]);
    expect(sheet.lines).toHaveLength(3);
    expect(sheet.lines.every((l) => l.payload)).toBe(true);
    expect(sheet.lines[0]!.payload).toMatchObject({ full_name: "Rahul Patil", email: "rahul.patil@company.com", team_id: 1, daily_target: 50, role: "employee", must_change_password: true });
    expect(sheet.lines[2]!.payload).toMatchObject({ role: "manager", daily_target: 0, team_id: null });
  });

  it("recognises the column names people actually use", () => {
    const sheet = parse("Employee Name,E-mail ID,Mobile No,Emp ID,Department,Designation,Daily Calls\nSneha Joshi,sneha@x.com,9822012345,emp77,Sales Team B,Manager,35");
    expect(sheet.missing).toEqual([]);
    expect(sheet.lines[0]!.payload).toMatchObject({ full_name: "Sneha Joshi", email: "sneha@x.com", phone: "9822012345", employee_code: "EMP77", team_id: 2, role: "manager", daily_target: 35 });
  });

  it("asks for the two columns that cannot be guessed", () => {
    expect(parse("name,city\nRahul,Pune").missing).toEqual(["email"]);
    expect(parse("email\nr@x.com").missing).toEqual(["name"]);
    expect(parse("city,age\nPune,30").missing).toEqual(["name", "email"]);
  });

  it("lists the columns it ignored", () => {
    expect(parse("name,email,favourite colour\nAarav Patil,a@x.com,green").ignored).toEqual(["favourite colour"]);
  });

  it("points at the exact line of every problem, counting the header like Excel does", () => {
    const sheet = parse(["name,email,role,daily_target,team", "Aarav Patil,a@x.com,employee,40,Sales Team A", "R,bad-email,employee,40,", "Meera Pawar,m@x.com,boss,40,", "Sai Kale,s@x.com,employee,5000,", "Priya Joshi,p@x.com,employee,,Nowhere"].join("\n"));
    expect(sheet.lines.map((l) => l.line)).toEqual([2, 3, 4, 5, 6]);
    expect(sheet.lines[0]!.problems).toEqual([]);
    expect(sheet.lines[1]!.problems).toEqual(["Name is missing.", "Email is not valid."]);
    expect(sheet.lines[2]!.problems[0]).toContain('"boss"');
    expect(sheet.lines[3]!.problems[0]).toContain("0 to 2000");
    expect(sheet.lines[4]!.problems[0]).toContain('Team "Nowhere" does not exist');
    expect(sheet.lines.slice(1).every((l) => l.payload === null)).toBe(true);
  });

  it("catches the same email or employee ID twice in one sheet", () => {
    const sheet = parse(["name,email,employee_id", "One One,same@x.com,EMP9", "Two Two,SAME@x.com,EMP8", "Three Three,three@x.com,emp9"].join("\n"));
    expect(sheet.lines[0]!.problems).toEqual([]);
    expect(sheet.lines[1]!.problems).toContain("Same email appears twice in the sheet.");
    expect(sheet.lines[2]!.problems).toContain("Same employee ID appears twice in the sheet.");
  });

  it("uses the organisation's default target when the cell is empty", () => {
    const sheet = parseEmployeeSheet("name,email\nAarav Patil,a@x.com", teams, 63);
    expect(sheet.lines[0]!.payload!.daily_target).toBe(63);
  });

  it("refuses a password that is too short but accepts an empty one (it is generated)", () => {
    const sheet = parse("name,email,password\nAarav Patil,a@x.com,abc\nSneha Joshi,s@x.com,");
    expect(sheet.lines[0]!.problems[0]).toContain("shorter than 8");
    expect(sheet.lines[1]!.payload!.password).toBeUndefined();
  });

  it("skips blank lines and survives a byte-order mark", () => {
    const sheet = parse("﻿name,email\r\n\r\nAarav Patil,a@x.com\r\n\r\n");
    expect(sheet.missing).toEqual([]);
    expect(sheet.lines).toHaveLength(1);
  });

  it("matches team names without caring about capitals", () => {
    expect(parse("name,email,team\nAarav Patil,a@x.com,sales team a").lines[0]!.payload!.team_id).toBe(1);
  });
});

describe("login sheet", () => {
  it("has a header and one row per employee", () => {
    const text = credentialsSheet([
      { name: "Aarav Patil", employeeCode: "EMP014", email: "a@x.com", password: "Abcd1234Efgh" },
      { name: "Sneha, Joshi", employeeCode: "EMP015", email: "s@x.com", password: "Zz9Zz9Zz9Zz9" },
    ]);
    expect(text.split("\r\n")).toEqual(["Name,Employee ID,Email,Password", "Aarav Patil,EMP014,a@x.com,Abcd1234Efgh", '"Sneha, Joshi",EMP015,s@x.com,Zz9Zz9Zz9Zz9']);
  });

  it("does not let a name run as a spreadsheet formula", () => {
    const text = credentialsSheet([{ name: "=HYPERLINK(\"http://evil\")", employeeCode: "EMP1", email: "e@x.com", password: "Passw0rdPassw0rd" }]);
    expect(text.split("\r\n")[1]!.startsWith("'=") || text.split("\r\n")[1]!.startsWith("\"'=")).toBe(true);
  });
});
