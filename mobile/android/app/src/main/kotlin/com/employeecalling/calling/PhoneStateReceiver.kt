package com.employeecalling.calling

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.telephony.TelephonyManager

/** Receives PHONE_STATE broadcasts (needs READ_PHONE_STATE) even when the app's JS runtime is not running. */
class PhoneStateReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        if (intent.action != TelephonyManager.ACTION_PHONE_STATE_CHANGED) return
        val state = intent.getStringExtra(TelephonyManager.EXTRA_STATE) ?: return
        CallStateTracker.handle(context.applicationContext, state, System.currentTimeMillis())
    }
}
