package com.employeecalling.calling

import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Handler
import android.os.Looper
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.WritableMap
import com.facebook.react.modules.core.DeviceEventManagerModule

/** Bridge from native callbacks (receiver, telephony listener, in-call service, media player) to JavaScript events. */
object PhoneEvents {
    @Volatile
    var reactContext: ReactApplicationContext? = null

    /** A tel: number another app asked us to dial (we are a phone app). JavaScript takes it once it can show the dialer. */
    @Volatile
    var pendingDial: String? = null

    fun emit(name: String, params: WritableMap) {
        val ctx = reactContext ?: return
        if (!ctx.hasActiveReactInstance()) return
        try {
            ctx.getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter::class.java).emit(name, params)
        } catch (e: Exception) {
            // The JS runtime is shutting down; the persisted session lets JS catch up later.
        }
    }

    fun emitDial(number: String) {
        val params = Arguments.createMap()
        params.putString("number", number)
        emit("CallingDialRequest", params)
    }
}

/** A phone number tapped in another app (tel: links, "Dial" buttons) reaches us as an intent when we are the phone app. */
object DialIntents {
    fun handle(intent: Intent?) {
        val data = intent?.data ?: return
        if (data.scheme != "tel") return
        if (intent.action != Intent.ACTION_DIAL && intent.action != Intent.ACTION_VIEW) return
        val number = Uri.decode(data.schemeSpecificPart ?: "")
        if (number.isBlank()) return
        PhoneEvents.pendingDial = number
        PhoneEvents.emitDial(number)
    }
}

/** Single entry point for phone-state changes, whichever source reported them. */
object CallStateTracker {
    private val main = Handler(Looper.getMainLooper())
    private var fallback: Runnable? = null

    /** When the in-call service owns the session, the radio's IDLE only counts if the service stays silent for this long. */
    private const val DIALER_END_GRACE_MS = 4_000L

    fun handle(ctx: Context, state: String, nowMs: Long, fromDialer: Boolean = false) {
        val appCtx = ctx.applicationContext
        if (state == "IDLE" && !fromDialer) {
            val session = CallSessionStore.current(appCtx)
            if (session != null && session.optString("source") == "dialer" && session.isNull("endedAtMs")) {
                fallback?.let { main.removeCallbacks(it) }
                val run = Runnable { handle(appCtx, "IDLE", nowMs, true) }
                fallback = run
                main.postDelayed(run, DIALER_END_GRACE_MS)
                return
            }
        }
        if (fromDialer) {
            fallback?.let { main.removeCallbacks(it) }
            fallback = null
        }
        val updated = CallSessionStore.onState(appCtx, state, nowMs, fromDialer)
        val params = Arguments.createMap()
        params.putString("state", state)
        params.putDouble("timestampMs", nowMs.toDouble())
        params.putString("sessionId", updated?.optString("id") ?: CallSessionStore.current(appCtx)?.optString("id"))
        params.putBoolean("sessionChanged", updated != null)
        PhoneEvents.emit("CallingPhoneState", params)
    }
}
