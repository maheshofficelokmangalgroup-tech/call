package com.employeecalling.calling

import android.content.Context
import org.json.JSONObject

/**
 * Persists the one outgoing CRM call the employee is currently making, so its start/end times (and, when the app is the
 * phone app, the disconnect cause and the recording) survive the React Native runtime being killed mid-call.
 *
 * Two sources can drive a session:
 *   "phone"  - the radio's phone state. OFFHOOK = the call was initiated, IDLE after OFFHOOK = it ended. Whether it was
 *              answered is read from the call log afterwards (see CallingModule.readCallLog).
 *   "dialer" - the in-call service (this app is the default phone app). It knows exactly when the call was answered and why it
 *              ended, so it owns the end of the session and the radio's IDLE is ignored (except as a delayed safety net).
 */
object CallSessionStore {
    private const val PREFS = "calling_session"
    private const val KEY = "active"
    private const val STALE_OFFHOOK_MS = 90_000L // ignore an OFFHOOK that arrives long after we placed the call

    private fun prefs(ctx: Context) = ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE)

    private fun save(ctx: Context, json: JSONObject) {
        prefs(ctx).edit().putString(KEY, json.toString()).apply()
    }

    @Synchronized
    fun begin(ctx: Context, id: String, number: String, startedAtMs: Long) {
        val json = JSONObject()
            .put("id", id)
            .put("number", number)
            .put("startedAtMs", startedAtMs)
            .put("offhookAtMs", JSONObject.NULL)
            .put("endedAtMs", JSONObject.NULL)
            .put("source", "phone")
            .put("answeredAtMs", JSONObject.NULL)
            .put("causeCode", -1)
            .put("causeReason", JSONObject.NULL)
            .put("recordingStatus", JSONObject.NULL)
            .put("recordingPath", JSONObject.NULL)
            .put("recordingDurationMs", 0)
        save(ctx, json)
    }

    @Synchronized
    fun current(ctx: Context): JSONObject? {
        val raw = prefs(ctx).getString(KEY, null) ?: return null
        return try {
            JSONObject(raw)
        } catch (e: Exception) {
            null
        }
    }

    /** Applies a phone-state change. Returns the updated session only when something changed. */
    @Synchronized
    fun onState(ctx: Context, state: String, nowMs: Long, fromDialer: Boolean = false): JSONObject? {
        val session = current(ctx) ?: return null
        if (!session.isNull("endedAtMs")) return null
        var changed = false
        when (state) {
            "OFFHOOK" -> if (session.isNull("offhookAtMs") && nowMs - session.getLong("startedAtMs") <= STALE_OFFHOOK_MS) {
                session.put("offhookAtMs", nowMs)
                changed = true
            }
            "IDLE" -> if (!session.isNull("offhookAtMs")) {
                if (session.optString("source") == "dialer" && !fromDialer) return null
                session.put("endedAtMs", nowMs)
                changed = true
            }
        }
        if (changed) save(ctx, session)
        return if (changed) session else null
    }

    /** Runs [block] on the session [id] and stores the result when [block] returns true. */
    @Synchronized
    private fun update(ctx: Context, id: String, block: (JSONObject) -> Boolean) {
        val session = current(ctx) ?: return
        if (session.optString("id") != id) return
        if (block(session)) save(ctx, session)
    }

    /** The in-call service has taken over this session. */
    fun markDialer(ctx: Context, id: String) = update(ctx, id) {
        it.put("source", "dialer")
        true
    }

    fun markAnswered(ctx: Context, id: String, atMs: Long) = update(ctx, id) {
        if (it.isNull("answeredAtMs")) {
            it.put("answeredAtMs", atMs)
            true
        } else {
            false
        }
    }

    fun markCause(ctx: Context, id: String, code: Int, reason: String?) = update(ctx, id) {
        it.put("causeCode", code)
        it.put("causeReason", reason ?: JSONObject.NULL)
        true
    }

    fun setRecording(ctx: Context, id: String, status: String, path: String?, durationMs: Long) = update(ctx, id) {
        it.put("recordingStatus", status)
        it.put("recordingPath", path ?: JSONObject.NULL)
        it.put("recordingDurationMs", durationMs)
        true
    }

    @Synchronized
    fun clear(ctx: Context, id: String?) {
        val session = current(ctx)
        if (session != null && (id == null || session.optString("id") == id)) {
            prefs(ctx).edit().remove(KEY).apply()
        }
    }
}
