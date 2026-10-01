package com.employeecalling.calling

import android.telecom.Call
import android.telecom.CallAudioState
import android.telecom.InCallService

/**
 * Telecom binds this service when the app is the phone app. It is told about every call (incoming, outgoing, personal or CRM)
 * and CallManager turns that into the call screen, the notification, the floating bubble and the events JavaScript listens to.
 */
class AppInCallService : InCallService() {

    override fun onCreate() {
        super.onCreate()
        CallManager.onServiceCreated(this)
    }

    override fun onDestroy() {
        CallManager.onServiceDestroyed(this)
        super.onDestroy()
    }

    override fun onCallAdded(call: Call) {
        super.onCallAdded(call)
        CallManager.onCallAdded(this, call)
    }

    override fun onCallRemoved(call: Call) {
        super.onCallRemoved(call)
        CallManager.onCallRemoved(this, call)
    }

    @Deprecated("Replaced by the call-endpoint callbacks on Android 14, which still report through this one")
    override fun onCallAudioStateChanged(audioState: CallAudioState?) {
        super.onCallAudioStateChanged(audioState)
        CallManager.onAudioChanged(audioState)
    }

    override fun onBringToForeground(showDialpad: Boolean) {
        super.onBringToForeground(showDialpad)
        CallManager.showUi(this)
    }
}
