package com.employeecalling.calling

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.os.Build
import android.telecom.Call
import androidx.core.app.NotificationCompat
import androidx.core.app.Person
import com.employeecalling.R

/** Incoming / ongoing call notifications (the system's call style, with Answer / Decline / Hang up). */
object CallNotifications {
    const val CH_INCOMING = "calls_incoming"
    const val CH_ONGOING = "calls_ongoing"
    const val ID_CALL = 7001

    const val ACTION_DECLINE = "com.employeecalling.action.DECLINE"
    const val ACTION_HANGUP = "com.employeecalling.action.HANGUP"

    private const val PI_FLAGS = PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT

    fun ensureChannels(ctx: Context) {
        if (Build.VERSION.SDK_INT < 26) return
        val nm = ctx.getSystemService(NotificationManager::class.java) ?: return
        val incoming = NotificationChannel(CH_INCOMING, "Incoming calls", NotificationManager.IMPORTANCE_HIGH).apply {
            description = "Rings and shows the call screen when someone calls you"
            setSound(null, null) // the phone itself plays the ringtone
            enableVibration(false)
            setShowBadge(false)
            lockscreenVisibility = Notification.VISIBILITY_PUBLIC
        }
        val ongoing = NotificationChannel(CH_ONGOING, "Ongoing calls", NotificationManager.IMPORTANCE_LOW).apply {
            description = "Shown while a call is in progress so you can return to it or hang up"
            setShowBadge(false)
            lockscreenVisibility = Notification.VISIBILITY_PUBLIC
        }
        nm.createNotificationChannel(incoming)
        nm.createNotificationChannel(ongoing)
    }

    private fun receiverIntent(ctx: Context, action: String, callId: String): Intent =
        Intent(ctx, CallActionReceiver::class.java).setAction(action).putExtra(InCallActivity.EXTRA_CALL_ID, callId)

    fun build(ctx: Context, t: TrackedCall): Notification {
        val ringing = t.incoming && t.state == Call.STATE_RINGING
        val title = t.name ?: if (t.number.isBlank()) "Unknown number" else t.number
        val person = Person.Builder().setName(title).setImportant(true).build()
        val open = PendingIntent.getActivity(ctx, 11, InCallActivity.intent(ctx, t.id), PI_FLAGS)

        val builder = NotificationCompat.Builder(ctx, if (ringing) CH_INCOMING else CH_ONGOING)
            .setSmallIcon(R.drawable.ic_stat_call)
            .setContentIntent(open)
            .setCategory(NotificationCompat.CATEGORY_CALL)
            .setOngoing(true)
            .setOnlyAlertOnce(true)
            .setShowWhen(false)
            .setColor(0xFF0C831F.toInt())
            .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
            .setForegroundServiceBehavior(NotificationCompat.FOREGROUND_SERVICE_IMMEDIATE)
            .addPerson(person)

        if (ringing) {
            val answer = PendingIntent.getActivity(ctx, 12, InCallActivity.intent(ctx, t.id).putExtra(InCallActivity.EXTRA_ACTION, "answer"), PI_FLAGS)
            val decline = PendingIntent.getBroadcast(ctx, 13, receiverIntent(ctx, ACTION_DECLINE, t.id), PI_FLAGS)
            builder
                .setPriority(NotificationCompat.PRIORITY_HIGH)
                .setFullScreenIntent(open, true)
                .setStyle(NotificationCompat.CallStyle.forIncomingCall(person, decline, answer))
        } else {
            val hangUp = PendingIntent.getBroadcast(ctx, 14, receiverIntent(ctx, ACTION_HANGUP, t.id), PI_FLAGS)
            builder.setStyle(NotificationCompat.CallStyle.forOngoingCall(person, hangUp))
            if (t.connectedAtMs > 0 && t.state == Call.STATE_ACTIVE) {
                builder.setUsesChronometer(true).setWhen(t.connectedAtMs).setShowWhen(true)
            } else {
                builder.setContentText(statusText(t))
            }
        }
        return builder.build()
    }

    private fun statusText(t: TrackedCall): String = when (t.state) {
        Call.STATE_HOLDING -> "On hold"
        Call.STATE_DISCONNECTING -> "Ending…"
        Call.STATE_ACTIVE -> "Ongoing call"
        else -> "Dialling…"
    }
}
