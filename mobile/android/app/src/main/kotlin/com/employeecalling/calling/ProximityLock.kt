package com.employeecalling.calling

import android.content.Context
import android.os.PowerManager
import android.util.Log

/** Turns the screen off while the phone is held to the ear during a call (like every phone app does). */
object ProximityLock {
    private const val TAG = "ProximityLock"
    private var lock: PowerManager.WakeLock? = null

    @Synchronized
    fun sync(ctx: Context, wanted: Boolean) {
        try {
            if (wanted) acquire(ctx) else release()
        } catch (e: Exception) {
            Log.w(TAG, "proximity lock failed", e)
        }
    }

    private fun acquire(ctx: Context) {
        if (lock?.isHeld == true) return
        val pm = ctx.applicationContext.getSystemService(Context.POWER_SERVICE) as? PowerManager ?: return
        if (!pm.isWakeLockLevelSupported(PowerManager.PROXIMITY_SCREEN_OFF_WAKE_LOCK)) return // e.g. emulators
        val created = pm.newWakeLock(PowerManager.PROXIMITY_SCREEN_OFF_WAKE_LOCK, "employeecalling:proximity")
        created.setReferenceCounted(false)
        created.acquire(4 * 60 * 60 * 1000L) // never held longer than a call could reasonably last
        lock = created
    }

    @Synchronized
    fun release() {
        try {
            lock?.let { if (it.isHeld) it.release() }
        } catch (e: Exception) {
            Log.w(TAG, "release failed", e)
        } finally {
            lock = null
        }
    }
}
