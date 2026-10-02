import type { APIRequestContext } from "@playwright/test";

import { BACKEND, unique } from "./helpers";

/** A short mono 8-bit WAV that plays in every browser: two "voices" taking turns. */
export function makeWav(seconds = 6, rate = 8000): Buffer {
  const samples = Buffer.alloc(rate * seconds, 128);
  let t = 0;
  let speaker = 0;
  while (t < samples.length) {
    const turn = Math.min(samples.length, t + Math.floor(rate * (1.2 + (t % 7) * 0.1)));
    const f0 = speaker === 0 ? 120 : 210;
    for (let i = 0; t < turn; i++, t++) {
      const envelope = Math.abs(Math.sin((Math.PI * (i % 1500)) / 1500));
      const x = 0.55 * Math.sin((2 * Math.PI * f0 * i) / rate) + 0.25 * Math.sin((4 * Math.PI * f0 * i) / rate);
      samples[t] = Math.max(0, Math.min(255, 128 + Math.round(60 * envelope * x)));
    }
    t += Math.floor(rate * 0.2);
    speaker ^= 1;
  }
  const header = Buffer.alloc(44);
  header.write("RIFF", 0);
  header.writeUInt32LE(36 + samples.length, 4);
  header.write("WAVE", 8);
  header.write("fmt ", 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20); // PCM
  header.writeUInt16LE(1, 22); // mono
  header.writeUInt32LE(rate, 24);
  header.writeUInt32LE(rate, 28); // byte rate
  header.writeUInt16LE(1, 32); // block align
  header.writeUInt16LE(8, 34); // bits per sample
  header.write("data", 36);
  header.writeUInt32LE(samples.length, 40);
  return Buffer.concat([header, samples]);
}

export interface PlacedCall {
  id: number;
  clientCallId: string;
  phone: string;
}

/**
 * Plays the part of an employee's phone: it signs in to the backend like the mobile app does and then dials, answers,
 * ends calls and uploads recordings. The admin panel under test sees these calls exactly as it would see real ones.
 */
export class FakePhone {
  private token = "";
  employeeId = 0;

  constructor(private readonly request: APIRequestContext) {}

  async signIn(identifier: string, password: string) {
    const res = await this.request.post(`${BACKEND}/api/v1/auth/login`, {
      data: { identifier, password, device: { device_uid: `e2e-phone-${identifier}`, name: "E2E Phone", platform: "android", app_version: "1.0.1", os_version: "Android 14" } },
    });
    if (!res.ok()) throw new Error(`phone sign-in failed: ${res.status()} ${await res.text()}`);
    const body = await res.json();
    this.token = body.access_token;
    this.employeeId = body.employee.id;
    return this;
  }

  private headers() {
    return { authorization: `Bearer ${this.token}` };
  }

  private async json<T>(res: Awaited<ReturnType<APIRequestContext["post"]>>, what: string): Promise<T> {
    if (!res.ok()) throw new Error(`${what} failed: ${res.status()} ${await res.text()}`);
    return (await res.json()) as T;
  }

  /** Press "call": the call exists on the server from this moment and counts as being in progress. */
  async dial(phone: string, startedAt: Date = new Date()): Promise<PlacedCall> {
    const clientCallId = `e2e-${unique()}-call`;
    const res = await this.request.post(`${BACKEND}/api/v1/calls`, { headers: this.headers(), data: { client_call_id: clientCallId, phone_number: phone, started_at: startedAt.toISOString() } });
    const call = await this.json<{ id: number }>(res, "dial");
    return { id: call.id, clientCallId, phone };
  }

  async answer(call: PlacedCall, answeredAt: Date = new Date()) {
    const res = await this.request.patch(`${BACKEND}/api/v1/calls/${call.id}`, { headers: this.headers(), data: { status: "connected", answered_at: answeredAt.toISOString() } });
    await this.json(res, "answer");
  }

  /** Hang up. `talkSeconds` 0 means nobody answered. `recording` is what the phone reports about its recorder. */
  async hangUp(call: PlacedCall, opts: { startedAt: Date; ringSeconds?: number; talkSeconds: number; outcome?: string; recording?: string; note?: string }) {
    const ring = opts.ringSeconds ?? 8;
    const answered = opts.talkSeconds > 0;
    const answeredAt = new Date(opts.startedAt.getTime() + ring * 1000);
    const endedAt = new Date(answeredAt.getTime() + opts.talkSeconds * 1000);
    const res = await this.request.patch(`${BACKEND}/api/v1/calls/${call.id}`, {
      headers: this.headers(),
      data: { status: answered ? "completed" : "no_answer", answered_at: answered ? answeredAt.toISOString() : null, ended_at: endedAt.toISOString(), duration_seconds: opts.talkSeconds },
    });
    await this.json(res, "hang up");
    const events = [
      { event_type: "dialing", occurred_at: opts.startedAt.toISOString() },
      { event_type: "ringing", occurred_at: new Date(opts.startedAt.getTime() + 2000).toISOString() },
      ...(answered ? [{ event_type: "connected", occurred_at: answeredAt.toISOString() }] : []),
      { event_type: "ended", occurred_at: endedAt.toISOString(), payload: opts.recording ? { recording: opts.recording } : undefined },
    ];
    await this.json(await this.request.post(`${BACKEND}/api/v1/calls/${call.id}/events`, { headers: this.headers(), data: { events } }), "events");
    if (opts.outcome) {
      await this.json(
        await this.request.post(`${BACKEND}/api/v1/calls/${call.id}/disposition`, { headers: this.headers(), data: { disposition_code: opts.outcome, notes: opts.note ?? null } }),
        "outcome",
      );
    }
  }

  /** Send the recording file the way the app does: first the description, then the audio itself. */
  async uploadRecording(call: PlacedCall, wav: Buffer = makeWav(), durationSeconds = 6) {
    const meta = await this.json<{ id: number }>(
      await this.request.post(`${BACKEND}/api/v1/calls/${call.id}/recording`, { headers: this.headers(), data: { content_type: "audio/wav", size_bytes: wav.length, duration_seconds: durationSeconds } }),
      "recording metadata",
    );
    await this.json(
      await this.request.post(`${BACKEND}/api/v1/recordings/${meta.id}/upload`, { headers: this.headers(), multipart: { file: { name: "call.wav", mimeType: "audio/wav", buffer: wav } } }),
      "recording upload",
    );
    return meta.id;
  }
}
