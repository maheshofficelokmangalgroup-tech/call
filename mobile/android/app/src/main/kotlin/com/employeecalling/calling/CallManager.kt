package com.employeecalling.calling

import android.Manifest
import android.content.Context
import android.content.pm.PackageManager
import android.content.pm.ServiceInfo
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.provider.ContactsContract
import android.telecom.Call
import android.telecom.CallAudioState
import android.telecom.DisconnectCause
import android.telecom.PhoneAccountHandle
import android.telecom.TelecomManager
import android.telecom.VideoProfile
import android.util.Log
import androidx.core.content.ContextCompat
import com.facebook.react.bridge.Arguments
import org.json.JSONArray
import org.json.JSONObject
import java.io.File
import java.util.concurrent.Executors

/** One call known to the in-call service. */
class TrackedCall(val id: String, val call: Call, val incoming: Boolean, val addedAtMs: Long) {
    var number: String = ""
    var name: String? = null
    var subtitle: String? = null
    /** Set when this is the CRM call the employee started from the app (see CallSessionStore). Personal calls have none. */
    var sessionId: String? = null
    var state: Int = Call.STATE_NEW
    var connectedAtMs: Long = 0L
    var endedAtMs: Long = 0L
    var cause: DisconnectCause? = null
    var finalized = false
    var recording: String = "off" // off | starting | recording | saved | silent | failed
    var hd = false
    var wifi = false
    var canHold = false
    var accountLabel: String? = null
    var accounts: List<PhoneAccountHandle> = emptyList()
    var callback: Call.Callback? = null
}

/**
 * The heart of the phone-app mode. Everything here runs on the main thread (Telecom callbacks, notification actions and the
 * commands coming from JavaScript are all posted to it), so the lists need no locking.
 */
object CallManager {
    private const val TAG = "CallManager"
    private const val ENDED_VISIBLE_MS = 3_500L

    private val main = Handler(Looper.getMainLooper())
    /** MediaRecorder start/stop can block for a second or two: never on the thread that draws the call screen. */
    private val recordingExecutor = Executors.newSingleThreadExecutor()
    private val live = ArrayList<TrackedCall>()
    private val ended = ArrayList<TrackedCall>()
    private var service: AppInCallService? = null
    private var audio: CallAudioState? = null
    private var seq = 0
    private var uiVisible = false
    private var recordingNow = false
    private var lastNotificationKey = ""

    /** The latest state for JavaScript; JS can ask for it at any time (cold start) without touching the main-thread lists. */
    @Volatile
    private var lastJson: String? = null

    // ------------------------------------------------------------------------------------------ lifecycle
    fun onServiceCreated(svc: AppInCallService) {
        service = svc
        CallNotifications.ensureChannels(svc.applicationContext)
    }

    fun onServiceDestroyed(svc: AppInCallService) {
        if (service !== svc) return
        service = null
        live.clear()
        ended.clear()
        recordingNow = false
        CallRecorder.stop()
        FloatingBubble.hide(svc.applicationContext)
        ProximityLock.release()
        lastNotificationKey = ""
        lastJson = null
    }

    fun onUiVisibility(ctx: Context, visible: Boolean) {
        uiVisible = visible
        FloatingBubble.sync(ctx.applicationContext)
    }

    fun isUiVisible(): Boolean = uiVisible

    // ---------------------------------------------------------------------------------------- telecom events
    private fun stateOf(call: Call): Int {
        return if (Build.VERSION.SDK_INT >= 31) {
            call.details?.state ?: Call.STATE_NEW
        } else {
            @Suppress("DEPRECATION")
            call.state
        }
    }

    private fun isIncoming(call: Call, state: Int): Boolean {
        if (Build.VERSION.SDK_INT >= 29) {
            when (call.details?.callDirection) {
                Call.Details.DIRECTION_INCOMING -> return true
                Call.Details.DIRECTION_OUTGOING -> return false
                else -> {}
            }
        }
        return state == Call.STATE_RINGING || state == 13 // 13 = STATE_SIMULATED_RINGING
    }

    private fun sameNumber(a: String, b: String): Boolean {
        val da = a.filter { it.isDigit() }
        val db = b.filter { it.isDigit() }
        if (da.length < 6 || db.length < 6) return da == db && da.isNotEmpty()
        return da.takeLast(10) == db.takeLast(10)
    }

    fun lookupName(ctx: Context, number: String): String? {
        if (number.isBlank()) return null
        if (ContextCompat.checkSelfPermission(ctx, Manifest.permission.READ_CONTACTS) != PackageManager.PERMISSION_GRANTED) return null
        return try {
            val uri = Uri.withAppendedPath(ContactsContract.PhoneLookup.CONTENT_FILTER_URI, Uri.encode(number))
            ctx.contentResolver.query(uri, arrayOf(ContactsContract.PhoneLookup.DISPLAY_NAME), null, null, null)?.use { cursor ->
                if (cursor.moveToFirst()) cursor.getString(0) else null
            }
        } catch (e: Exception) {
            null
        }
    }

    fun onCallAdded(svc: AppInCallService, call: Call) {
        service = svc
        val ctx = svc.applicationContext
        val now = System.currentTimeMillis()
        val state = stateOf(call)
        val incoming = isIncoming(call, state)
        val tracked = TrackedCall("c${++seq}-$now", call, incoming, now)
        tracked.state = state
        tracked.number = Uri.decode(call.details?.handle?.schemeSpecificPart ?: "")
        tracked.name = CrmLookup.nameFor(ctx, tracked.number) ?: lookupName(ctx, tracked.number) ?: call.details?.callerDisplayName?.takeIf { it.isNotBlank() }
        call.details?.let { readDetails(ctx, tracked, it) }
        if (audio == null) {
            @Suppress("DEPRECATION")
            audio = svc.callAudioState
        }
        if (!incoming) linkSession(ctx, tracked, now)

        val callback = object : Call.Callback() {
            override fun onStateChanged(call: Call, state: Int) = handleState(tracked, state)

            override fun onDetailsChanged(call: Call, details: Call.Details) {
                val appCtx = service?.applicationContext ?: return
                readDetails(appCtx, tracked, details)
                refresh()
            }
        }
        tracked.callback = callback
        call.registerCallback(callback)
        live.add(tracked)

        if (state == Call.STATE_ACTIVE) markConnected(ctx, tracked, now) // e.g. the app restarted in the middle of a call
        refresh()
        if (!incoming) launchUi(ctx, tracked.id) // incoming calls come with a full-screen notification instead
    }

    /** Matches the call to the CRM session the employee started from the app, so it is logged and (when enabled) recorded. */
    private fun linkSession(ctx: Context, t: TrackedCall, now: Long) {
        val session = CallSessionStore.current(ctx) ?: return
        if (!session.isNull("endedAtMs") || session.optString("source") == "dialer") return
        if (now - session.optLong("startedAtMs") > 120_000) return
        if (!sameNumber(session.optString("number"), t.number)) return
        val id = session.optString("id")
        t.sessionId = id
        CallSessionStore.markDialer(ctx, id)
        CallStateTracker.handle(ctx, "OFFHOOK", now, fromDialer = true)
    }

    private fun readDetails(ctx: Context, t: TrackedCall, details: Call.Details) {
        t.hd = details.hasProperty(Call.Details.PROPERTY_HIGH_DEF_AUDIO)
        t.wifi = details.hasProperty(Call.Details.PROPERTY_WIFI)
        t.canHold = details.can(Call.Details.CAPABILITY_HOLD)
        if (t.name == null) t.name = details.callerDisplayName?.takeIf { it.isNotBlank() }
        val handle = details.accountHandle
        if (handle != null && t.accountLabel == null) {
            t.accountLabel = try {
                (ctx.getSystemService(Context.TELECOM_SERVICE) as TelecomManager).getPhoneAccount(handle)?.label?.toString()
            } catch (e: Exception) {
                null
            }
        }
        if (t.state == Call.STATE_SELECT_PHONE_ACCOUNT) t.accounts = availableAccounts(details.extras)
    }

    @Suppress("DEPRECATION")
    private fun availableAccounts(extras: Bundle?): List<PhoneAccountHandle> =
        try {
            extras?.getParcelableArrayList<PhoneAccountHandle>(Call.AVAILABLE_PHONE_ACCOUNTS) ?: emptyList()
        } catch (e: Exception) {
            emptyList()
        }

    private fun handleState(t: TrackedCall, state: Int) {
        val ctx = service?.applicationContext ?: return
        val now = System.currentTimeMillis()
        t.state = state
        when (state) {
            Call.STATE_ACTIVE -> markConnected(ctx, t, now)
            Call.STATE_SELECT_PHONE_ACCOUNT -> t.call.details?.let { readDetails(ctx, t, it) }
            Call.STATE_DISCONNECTED -> finalizeCall(ctx, t, t.call.details?.disconnectCause, now)
        }
        refresh()
    }

    private fun markConnected(ctx: Context, t: TrackedCall, now: Long) {
        if (t.connectedAtMs != 0L) return
        val connect = t.call.details?.connectTimeMillis ?: 0L
        t.connectedAtMs = if (connect > 0) connect else now
        t.sessionId?.let { CallSessionStore.markAnswered(ctx, it, t.connectedAtMs) }
        startRecordingIfNeeded(ctx, t)
    }

    /** The call is over: stop recording, hand the real outcome (cause, answer time, recording) to the session, tell JS. */
    private fun finalizeCall(ctx: Context, t: TrackedCall, cause: DisconnectCause?, now: Long) {
        if (t.finalized) return
        t.finalized = true
        t.cause = cause
        t.endedAtMs = now
        recordingNow = false
        if (t.recording == "starting" || t.recording == "recording") {
            // Stopping can take a moment, so it happens off the main thread - and JavaScript is told the call ended only after
            // that, so the recording result is already in the session when it looks. (The executor runs a pending start first.)
            recordingExecutor.execute {
                val result = CallRecorder.stop()
                main.post {
                    applyRecordingResult(ctx, t, result)
                    reportEnd(ctx, t, cause, now)
                    refresh()
                }
            }
        } else {
            reportEnd(ctx, t, cause, now)
        }
    }

    private fun reportEnd(ctx: Context, t: TrackedCall, cause: DisconnectCause?, now: Long) {
        val sessionId = t.sessionId ?: return
        CallSessionStore.markCause(ctx, sessionId, cause?.code ?: -1, cause?.reason)
        CallStateTracker.handle(ctx, "IDLE", now, fromDialer = true)
    }

    fun onCallRemoved(svc: AppInCallService, call: Call) {
        val t = live.firstOrNull { it.call === call } ?: return
        val ctx = svc.applicationContext
        try {
            t.callback?.let { call.unregisterCallback(it) }
        } catch (e: Exception) {
            // already unregistered
        }
        if (!t.finalized) finalizeCall(ctx, t, t.cause, System.currentTimeMillis())
        live.remove(t)
        t.state = Call.STATE_DISCONNECTED
        ended.add(t)
        main.postDelayed({
            ended.remove(t)
            refresh()
        }, ENDED_VISIBLE_MS)
        refresh()
        if (live.isEmpty()) {
            // JavaScript closes the screen after showing "Call ended"; this is only the safety net if it is not running
            main.postDelayed({
                if (live.isEmpty()) InCallActivity.current?.closeScreen(false)
            }, ENDED_VISIBLE_MS + 1_500)
        }
    }

    fun onAudioChanged(state: CallAudioState?) {
        audio = state
        refresh()
    }

    // --------------------------------------------------------------------------------------------- recording
    private fun hasMic(ctx: Context) = ContextCompat.checkSelfPermission(ctx, Manifest.permission.RECORD_AUDIO) == PackageManager.PERMISSION_GRANTED

    private fun startRecordingIfNeeded(ctx: Context, t: TrackedCall) {
        val sessionId = t.sessionId ?: return // personal calls are never recorded
        if (t.incoming || !CallPrefs.recordingEnabled(ctx)) return
        if (!hasMic(ctx)) {
            t.recording = "failed"
            CallSessionStore.setRecording(ctx, sessionId, "no_permission", null, 0)
            return
        }
        t.recording = "starting"
        recordingNow = true
        service?.let { updateForeground(it, ctx, force = true) } // raise the service to the microphone type first
        recordingExecutor.execute {
            val ok = CallRecorder.start(ctx, sessionId)
            main.post {
                if (t.recording != "starting") return@post // already handled
                t.recording = if (ok) "recording" else "failed"
                if (!ok) recordingNow = false
                CallSessionStore.setRecording(ctx, sessionId, if (ok) "recording" else "failed", null, 0)
                refresh()
            }
        }
    }

    /** Records what the recorder produced in the session (and throws away a recording that holds nothing but silence). */
    private fun applyRecordingResult(ctx: Context, t: TrackedCall, result: CallRecorder.Result?) {
        val sessionId = t.sessionId
        when {
            result == null -> {
                t.recording = "failed"
                if (sessionId != null) CallSessionStore.setRecording(ctx, sessionId, "failed", null, 0)
            }
            result.silent -> {
                File(result.path).delete() // nothing but silence was captured: do not pretend it is a recording
                t.recording = "silent"
                if (sessionId != null) CallSessionStore.setRecording(ctx, sessionId, "silent", null, result.durationMs)
            }
            else -> {
                t.recording = "saved"
                if (sessionId != null) CallSessionStore.setRecording(ctx, sessionId, "saved", result.path, result.durationMs)
            }
        }
    }

    // ------------------------------------------------------------------------------------------------ views
    private fun rank(t: TrackedCall): Int = when (t.state) {
        Call.STATE_ACTIVE -> 0
        Call.STATE_DIALING, Call.STATE_CONNECTING, Call.STATE_SELECT_PHONE_ACCOUNT, Call.STATE_NEW -> 1
        Call.STATE_RINGING -> 2
        Call.STATE_HOLDING -> 3
        Call.STATE_DISCONNECTING -> 4
        else -> 5
    }

    private fun primaryLive(): TrackedCall? = live.minByOrNull { rank(it) }

    /** The call the call screen is about (the newest ended call stays for a moment so "Call ended" can show). */
    fun callForUi(): TrackedCall? = primaryLive() ?: ended.lastOrNull()

    private fun refresh() {
        val svc = service
        val ctx = svc?.applicationContext
        if (svc != null && ctx != null) {
            updateForeground(svc, ctx)
            FloatingBubble.sync(ctx)
            val earpiece = audio?.route.let { it == CallAudioState.ROUTE_EARPIECE || it == CallAudioState.ROUTE_WIRED_OR_EARPIECE }
            val onCall = live.any { it.state == Call.STATE_ACTIVE || it.state == Call.STATE_DIALING || it.state == Call.STATE_CONNECTING }
            ProximityLock.sync(ctx, onCall && earpiece)
        }
        emit(svc?.applicationContext)
        InCallActivity.current?.bindFallback()
    }

    private fun updateForeground(svc: AppInCallService, ctx: Context, force: Boolean = false) {
        val alive = live.filter { it.state != Call.STATE_DISCONNECTED }
        if (alive.isEmpty()) {
            lastNotificationKey = ""
            try {
                svc.stopForeground(android.app.Service.STOP_FOREGROUND_REMOVE)
            } catch (e: Exception) {
                Log.w(TAG, "stopForeground failed", e)
            }
            return
        }
        val target = alive.firstOrNull { it.incoming && it.state == Call.STATE_RINGING } ?: primaryLive() ?: return
        val key = "${target.id}|${target.state}|${target.name}|${target.connectedAtMs}|$recordingNow"
        if (!force && key == lastNotificationKey) return
        lastNotificationKey = key

        val notification = CallNotifications.build(ctx, target)
        var withMic = recordingNow && hasMic(ctx)
        for (attempt in 0..1) {
            try {
                if (Build.VERSION.SDK_INT >= 29) {
                    var type = ServiceInfo.FOREGROUND_SERVICE_TYPE_PHONE_CALL
                    if (withMic && Build.VERSION.SDK_INT >= 30) type = type or ServiceInfo.FOREGROUND_SERVICE_TYPE_MICROPHONE
                    svc.startForeground(CallNotifications.ID_CALL, notification, type)
                } else {
                    svc.startForeground(CallNotifications.ID_CALL, notification)
                }
                return
            } catch (e: Exception) {
                Log.w(TAG, "startForeground failed (mic=$withMic)", e)
                withMic = false
            }
        }
        try {
            (ctx.getSystemService(Context.NOTIFICATION_SERVICE) as android.app.NotificationManager).notify(CallNotifications.ID_CALL, notification)
        } catch (e: Exception) {
            Log.w(TAG, "notify failed", e)
        }
    }

    fun bubbleState(): BubbleState? {
        val t = primaryLive() ?: return null
        val title = t.name ?: if (t.number.isBlank()) "Unknown number" else t.number
        val status = when (t.state) {
            Call.STATE_RINGING -> "Incoming call"
            Call.STATE_HOLDING -> "On hold"
            Call.STATE_ACTIVE -> "Connected"
            else -> "Dialling…"
        }
        return BubbleState(t.id, title, status, t.connectedAtMs, t.state == Call.STATE_ACTIVE)
    }

    // --------------------------------------------------------------------------------------------- snapshot
    private fun stateName(state: Int): String = when (state) {
        Call.STATE_ACTIVE -> "active"
        Call.STATE_DIALING, Call.STATE_PULLING_CALL -> "dialing"
        Call.STATE_RINGING, 13 -> "ringing"
        Call.STATE_HOLDING -> "holding"
        Call.STATE_DISCONNECTING -> "disconnecting"
        Call.STATE_DISCONNECTED -> "disconnected"
        Call.STATE_SELECT_PHONE_ACCOUNT -> "select_sim"
        else -> "connecting"
    }

    fun handleKey(h: PhoneAccountHandle): String = h.componentName.flattenToString() + "#" + h.id

    private fun simLabel(ctx: Context, h: PhoneAccountHandle): String = try {
        (ctx.getSystemService(Context.TELECOM_SERVICE) as TelecomManager).getPhoneAccount(h)?.label?.toString() ?: "SIM"
    } catch (e: Exception) {
        "SIM"
    }

    private fun callJson(ctx: Context, t: TrackedCall): JSONObject {
        val o = JSONObject()
        o.put("id", t.id)
        o.put("number", t.number)
        o.put("name", t.name ?: JSONObject.NULL)
        o.put("subtitle", t.subtitle ?: JSONObject.NULL)
        o.put("incoming", t.incoming)
        o.put("state", stateName(t.state))
        o.put("addedAtMs", t.addedAtMs)
        o.put("connectedAtMs", t.connectedAtMs)
        o.put("endedAtMs", t.endedAtMs)
        o.put("sessionId", t.sessionId ?: JSONObject.NULL)
        o.put("recording", t.recording)
        o.put("hd", t.hd)
        o.put("wifi", t.wifi)
        o.put("canHold", t.canHold)
        o.put("account", t.accountLabel ?: JSONObject.NULL)
        o.put("causeCode", t.cause?.code ?: -1)
        o.put("causeReason", t.cause?.reason ?: JSONObject.NULL)
        val sims = JSONArray()
        if (t.state == Call.STATE_SELECT_PHONE_ACCOUNT) {
            for (h in t.accounts) sims.put(JSONObject().put("id", handleKey(h)).put("label", simLabel(ctx, h)))
        }
        o.put("sims", sims)
        return o
    }

    private fun routeName(route: Int?): String = when (route) {
        CallAudioState.ROUTE_SPEAKER -> "speaker"
        CallAudioState.ROUTE_BLUETOOTH -> "bluetooth"
        CallAudioState.ROUTE_WIRED_HEADSET -> "wired"
        else -> "earpiece"
    }

    fun isDefaultDialer(ctx: Context): Boolean = try {
        (ctx.getSystemService(Context.TELECOM_SERVICE) as TelecomManager).defaultDialerPackage == ctx.packageName
    } catch (e: Exception) {
        false
    }

    private fun buildSnapshot(ctx: Context?): String {
        val o = JSONObject()
        val calls = JSONArray()
        if (ctx != null) {
            for (t in live) calls.put(callJson(ctx, t))
            for (t in ended) calls.put(callJson(ctx, t))
        }
        o.put("calls", calls)
        val primary = primaryLive() ?: ended.lastOrNull()
        o.put("primaryId", primary?.id ?: JSONObject.NULL)
        o.put("muted", audio?.isMuted ?: false)
        o.put("route", routeName(audio?.route))
        val routes = JSONArray()
        val mask = audio?.supportedRouteMask ?: 0
        if (mask and (CallAudioState.ROUTE_EARPIECE or CallAudioState.ROUTE_WIRED_HEADSET) != 0 || mask == 0) routes.put("earpiece")
        if (mask and CallAudioState.ROUTE_BLUETOOTH != 0) routes.put("bluetooth")
        if (mask and CallAudioState.ROUTE_WIRED_HEADSET != 0) routes.put("wired")
        if (mask and CallAudioState.ROUTE_SPEAKER != 0 || mask == 0) routes.put("speaker")
        o.put("routes", routes)
        o.put("defaultDialer", ctx?.let { isDefaultDialer(it) } ?: false)
        o.put("recordingEnabled", ctx?.let { CallPrefs.recordingEnabled(it) } ?: false)
        o.put("ts", System.currentTimeMillis())
        return o.toString()
    }

    private fun emit(ctx: Context?) {
        val json = buildSnapshot(ctx)
        lastJson = json
        val params = Arguments.createMap()
        params.putString("json", json)
        PhoneEvents.emit("CallingCallState", params)
    }

    /** The newest state (kept up to date by every change); an empty snapshot when no call is going on. */
    fun snapshot(ctx: Context): String = lastJson ?: buildSnapshot(null).let { JSONObject(it).put("defaultDialer", isDefaultDialer(ctx)).toString() }

    /** JavaScript knows the CRM name of the person being called; show it in the notification and the bubble as well. */
    fun setDisplay(callId: String, name: String?, subtitle: String?) {
        main.post {
            val t = live.firstOrNull { it.id == callId } ?: return@post
            if (!name.isNullOrBlank()) t.name = name
            t.subtitle = subtitle
            refresh()
        }
    }

    // --------------------------------------------------------------------------------------------- commands
    fun showUi(ctx: Context) {
        launchUi(ctx.applicationContext, primaryLive()?.id)
    }

    private fun launchUi(ctx: Context, callId: String?) {
        try {
            ctx.startActivity(InCallActivity.intent(ctx, callId))
        } catch (e: Exception) {
            Log.w(TAG, "could not open the call screen", e)
        }
    }

    fun runAction(ctx: Context, action: String, callId: String?, arg: String?) {
        val appCtx = ctx.applicationContext
        main.post { perform(appCtx, action, callId, arg) }
    }

    private fun routeValue(name: String?): Int = when (name) {
        "speaker" -> CallAudioState.ROUTE_SPEAKER
        "bluetooth" -> CallAudioState.ROUTE_BLUETOOTH
        "wired" -> CallAudioState.ROUTE_WIRED_HEADSET
        else -> CallAudioState.ROUTE_WIRED_OR_EARPIECE
    }

    private fun perform(ctx: Context, action: String, callId: String?, arg: String?) {
        val svc = service
        val target = callId?.let { id -> live.firstOrNull { it.id == id } } ?: primaryLive()
        try {
            when (action) {
                "answer" -> target?.call?.answer(VideoProfile.STATE_AUDIO_ONLY)
                "reject" -> target?.call?.reject(false, null)
                "hangup" -> target?.let { if (it.state == Call.STATE_RINGING) it.call.reject(false, null) else it.call.disconnect() }
                "hold" -> target?.call?.hold()
                "unhold" -> target?.call?.unhold()
                "swap" -> swap(target)
                "mute" -> svc?.setMuted(arg == "true")
                "route" -> svc?.setAudioRoute(routeValue(arg))
                "dtmf" -> {
                    val digit = arg?.firstOrNull()
                    val call = target?.call
                    if (digit != null && call != null) {
                        call.playDtmfTone(digit)
                        main.postDelayed({ call.stopDtmfTone() }, 160)
                    }
                }
                "selectSim" -> target?.accounts?.firstOrNull { handleKey(it) == arg }?.let { target.call.phoneAccountSelected(it, false) }
                "closeUi" -> InCallActivity.current?.closeScreen(arg == "main")
            }
        } catch (e: Exception) {
            Log.w(TAG, "action $action failed", e)
        }
        // Telecom confirms asynchronously; read the audio state back shortly after a change
        if (action == "mute" || action == "route") {
            main.postDelayed({
                @Suppress("DEPRECATION")
                service?.callAudioState?.let { audio = it }
                refresh()
            }, 250)
        }
    }

    private fun swap(target: TrackedCall?) {
        val active = live.firstOrNull { it.state == Call.STATE_ACTIVE }
        val held = live.firstOrNull { it.state == Call.STATE_HOLDING && it !== active }
        if (active != null && held != null) {
            active.call.hold()
            held.call.unhold()
        } else if (held != null) {
            held.call.unhold()
        } else if (active != null) {
            active.call.hold()
        } else {
            target?.call?.unhold()
        }
    }
}
