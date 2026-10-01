package com.employeecalling.calling

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent

/** Decline / Hang up buttons of the call notification (Answer opens the call screen instead, see CallNotifications). */
class CallActionReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        val callId = intent.getStringExtra(InCallActivity.EXTRA_CALL_ID)
        when (intent.action) {
            CallNotifications.ACTION_DECLINE -> CallManager.runAction(context, "reject", callId, null)
            CallNotifications.ACTION_HANGUP -> CallManager.runAction(context, "hangup", callId, null)
        }
    }
}
