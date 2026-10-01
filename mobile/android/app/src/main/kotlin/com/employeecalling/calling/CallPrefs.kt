package com.employeecalling.calling

import android.content.Context

/** The few settings the native call layer needs even when the JavaScript runtime is not running. */
object CallPrefs {
    private const val FILE = "calling_prefs"

    private fun prefs(ctx: Context) = ctx.applicationContext.getSharedPreferences(FILE, Context.MODE_PRIVATE)

    /** Set from the server configuration; recording only ever happens for calls started from the CRM queue/dialer. */
    fun recordingEnabled(ctx: Context): Boolean = prefs(ctx).getBoolean("recording_enabled", false)

    fun setRecordingEnabled(ctx: Context, enabled: Boolean) {
        prefs(ctx).edit().putBoolean("recording_enabled", enabled).apply()
    }

    fun bubbleEnabled(ctx: Context): Boolean = prefs(ctx).getBoolean("bubble_enabled", true)

    fun setBubbleEnabled(ctx: Context, enabled: Boolean) {
        prefs(ctx).edit().putBoolean("bubble_enabled", enabled).apply()
    }
}
