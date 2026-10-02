import Papa from "papaparse";

import type { EmployeeCreate, Team } from "@/lib/types";

/** One line of an uploaded employee sheet, after the columns were recognised. */
export interface ImportLine {
  /** 1-based line number in the sheet, counting the header, so it matches what the person sees in Excel */
  line: number;
  full_name: string;
  email: string;
  phone: string;
  employee_code: string;
  team: string;
  role: string;
  daily_target: string;
  password: string;
  /** what is wrong with the line; empty when it can be imported */
  problems: string[];
  payload: EmployeeCreate | null;
}

const COLUMN_ALIASES: Record<keyof Omit<ImportLine, "line" | "problems" | "payload">, string[]> = {
  full_name: ["name", "fullname", "employeename", "employee", "staffname"],
  email: ["email", "emailid", "emailaddress", "mail"],
  phone: ["phone", "mobile", "mobileno", "mobilenumber", "phonenumber", "contact", "contactnumber"],
  employee_code: ["employeeid", "employeecode", "empid", "empcode", "code", "id"],
  team: ["team", "teamname", "group", "department"],
  role: ["role", "designation", "type"],
  daily_target: ["target", "dailytarget", "calltarget", "dailycalls", "calls"],
  password: ["password", "pass", "initialpassword"],
};

const normalise = (header: string) => header.toLowerCase().replace(/[^a-z0-9]/g, "");

export const SAMPLE_CSV = [
  "name,email,phone,employee_id,team,role,daily_target",
  "Rahul Patil,rahul.patil@company.com,+919876543210,,Sales Team A,employee,50",
  "Sneha Kulkarni,sneha.kulkarni@company.com,9822012345,EMP100,Sales Team B,employee,60",
  "Amit Joshi,amit.joshi@company.com,,,,manager,0",
].join("\r\n");

const EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
const CODE = /^[A-Za-z0-9_.-]{2,32}$/;

export interface ParsedSheet {
  lines: ImportLine[];
  /** columns of the sheet that were not recognised and are ignored */
  ignored: string[];
  /** required columns that are missing altogether */
  missing: string[];
}

export function parseEmployeeSheet(text: string, teams: Team[], defaultTarget: number): ParsedSheet {
  const parsed = Papa.parse<Record<string, string>>(text.replace(/^﻿/, ""), { header: true, skipEmptyLines: "greedy", transformHeader: (h) => h.trim() });
  const headers = parsed.meta.fields ?? [];
  const column = new Map<string, string>(); // our field -> header in the file
  const used = new Set<string>();
  for (const [field, aliases] of Object.entries(COLUMN_ALIASES)) {
    const match = headers.find((h) => aliases.includes(normalise(h)) && !used.has(h));
    if (match) {
      column.set(field, match);
      used.add(match);
    }
  }
  const missing = ["full_name", "email"].filter((f) => !column.has(f)).map((f) => (f === "full_name" ? "name" : "email"));
  const ignored = headers.filter((h) => !used.has(h));
  const teamByName = new Map(teams.map((t) => [t.name.trim().toLowerCase(), t]));

  const seenEmails = new Set<string>();
  const seenCodes = new Set<string>();
  const lines: ImportLine[] = parsed.data.map((row, index) => {
    const get = (field: string) => (row[column.get(field) ?? ""] ?? "").toString().trim();
    const line: ImportLine = {
      line: index + 2,
      full_name: get("full_name"),
      email: get("email").toLowerCase(),
      phone: get("phone"),
      employee_code: get("employee_code").toUpperCase(),
      team: get("team"),
      role: (get("role") || "employee").toLowerCase(),
      daily_target: get("daily_target"),
      password: get("password"),
      problems: [],
      payload: null,
    };
    const problems = line.problems;
    if (line.full_name.length < 2) problems.push("Name is missing.");
    if (!EMAIL.test(line.email)) problems.push(line.email ? "Email is not valid." : "Email is missing.");
    else if (seenEmails.has(line.email)) problems.push("Same email appears twice in the sheet.");
    if (line.employee_code) {
      if (!CODE.test(line.employee_code)) problems.push("Employee ID may only use letters, numbers, - _ . (2-32 characters).");
      else if (seenCodes.has(line.employee_code)) problems.push("Same employee ID appears twice in the sheet.");
    }
    if (!["employee", "manager", "admin"].includes(line.role)) problems.push(`Role "${line.role}" is not employee, manager or admin.`);
    let target = defaultTarget;
    if (line.daily_target) {
      const n = Number(line.daily_target);
      if (!Number.isInteger(n) || n < 0 || n > 2000) problems.push("Daily target must be a whole number from 0 to 2000.");
      else target = n;
    }
    let teamId: number | null = null;
    if (line.team) {
      const team = teamByName.get(line.team.toLowerCase());
      if (!team) problems.push(`Team "${line.team}" does not exist. Create it first, or leave the cell empty.`);
      else teamId = team.id;
    }
    if (line.password && line.password.length < 8) problems.push("Password is shorter than 8 characters (or leave it empty to generate one).");

    if (EMAIL.test(line.email)) seenEmails.add(line.email);
    if (line.employee_code) seenCodes.add(line.employee_code);

    if (problems.length === 0) {
      line.payload = {
        full_name: line.full_name,
        email: line.email,
        phone: line.phone || undefined,
        employee_code: line.employee_code || undefined,
        role: line.role as EmployeeCreate["role"],
        team_id: teamId,
        daily_target: target,
        password: line.password || undefined,
        must_change_password: true,
        device_binding_enabled: false,
      };
    }
    return line;
  });
  return { lines, ignored, missing };
}

/** The sheet an administrator keeps (or prints) to hand the passwords over. */
export function credentialsSheet(rows: { name: string; employeeCode: string; email: string; password: string }[]): string {
  return Papa.unparse(
    [["Name", "Employee ID", "Email", "Password"], ...rows.map((r) => [r.name, r.employeeCode, r.email, r.password])].map((row) => row.map((cell) => (/^[=+\-@\t\r]/.test(String(cell)) ? `'${cell}` : cell))),
    { newline: "\r\n" },
  );
}
