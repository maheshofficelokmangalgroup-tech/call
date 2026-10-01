package com.employeecalling.calling

import android.content.Context
import android.graphics.Color
import android.graphics.Typeface
import android.graphics.drawable.GradientDrawable
import android.os.SystemClock
import android.telecom.Call
import android.view.Gravity
import android.view.View
import android.widget.Chronometer
import android.widget.FrameLayout
import android.widget.ImageView
import android.widget.LinearLayout
import android.widget.TextView
import com.employeecalling.R

/**
 * A plain native call screen shown the instant the call screen opens. The React UI takes a moment to start (especially when a
 * call arrives while the app is closed), and if it ever fails the employee must still be able to answer and hang up - so this
 * sits on top of it until the React UI reports that it is on screen (CallingModule.inCallUiReady).
 */
class InCallFallbackView(context: Context) : FrameLayout(context) {
    private val density = resources.displayMetrics.density
    private fun dp(v: Int) = (v * density).toInt()

    private val bold = typeface("Poppins-Bold", Typeface.DEFAULT_BOLD)
    private val medium = typeface("Poppins-Medium", Typeface.DEFAULT)

    private val nameView = TextView(context)
    private val numberView = TextView(context)
    private val statusView = TextView(context)
    private val timerView = Chronometer(context)
    private val answerButton: View
    private val declineButton: View
    private val endButton: View
    private var boundCallId: String? = null

    private fun typeface(name: String, fallback: Typeface): Typeface = try {
        Typeface.createFromAsset(context.assets, "fonts/$name.ttf")
    } catch (e: Exception) {
        fallback
    }

    private fun circle(color: Int, icon: Int, sizeDp: Int, onClick: () -> Unit): FrameLayout = FrameLayout(context).apply {
        layoutParams = LinearLayout.LayoutParams(dp(sizeDp), dp(sizeDp)).apply { setMargins(dp(26), 0, dp(26), 0) }
        background = GradientDrawable().apply {
            shape = GradientDrawable.OVAL
            setColor(color)
        }
        addView(ImageView(context).apply { setImageResource(icon) }, LayoutParams(dp(sizeDp / 2 + 4), dp(sizeDp / 2 + 4), Gravity.CENTER))
        setOnClickListener { onClick() }
    }

    init {
        setBackgroundColor(0xFF074F13.toInt())
        isClickable = true // swallow touches until the React UI takes over

        val column = LinearLayout(context).apply {
            orientation = LinearLayout.VERTICAL
            gravity = Gravity.CENTER_HORIZONTAL
            setPadding(dp(24), dp(96), dp(24), dp(56))
        }
        val avatar = FrameLayout(context).apply {
            background = GradientDrawable().apply {
                shape = GradientDrawable.OVAL
                setColor(0x33FFFFFF)
            }
            addView(ImageView(context).apply { setImageResource(R.drawable.ic_stat_call) }, LayoutParams(dp(54), dp(54), Gravity.CENTER))
        }
        column.addView(avatar, LinearLayout.LayoutParams(dp(120), dp(120)))

        nameView.apply {
            setTextColor(Color.WHITE)
            textSize = 24f
            typeface = bold
            gravity = Gravity.CENTER
            maxLines = 2
            includeFontPadding = false
            setPadding(0, dp(24), 0, dp(4))
        }
        numberView.apply {
            setTextColor(0xDDFFFFFF.toInt())
            textSize = 15f
            typeface = medium
            gravity = Gravity.CENTER
            includeFontPadding = false
        }
        statusView.apply {
            setTextColor(0xFFF8CB46.toInt())
            textSize = 17f
            typeface = bold
            gravity = Gravity.CENTER
            setPadding(0, dp(18), 0, 0)
        }
        timerView.apply {
            setTextColor(Color.WHITE)
            textSize = 30f
            typeface = bold
            gravity = Gravity.CENTER
            visibility = View.GONE
        }
        column.addView(nameView)
        column.addView(numberView)
        column.addView(timerView)
        column.addView(statusView)
        column.addView(View(context), LinearLayout.LayoutParams(0, 0, 1f)) // pushes the buttons to the bottom

        declineButton = circle(0xFFE23744.toInt(), R.drawable.ic_call_end, 76) { CallManager.runAction(context, "reject", boundCallId, null) }
        answerButton = circle(0xFF0C831F.toInt(), R.drawable.ic_stat_call, 76) { CallManager.runAction(context, "answer", boundCallId, null) }
        endButton = circle(0xFFE23744.toInt(), R.drawable.ic_call_end, 76) { CallManager.runAction(context, "hangup", boundCallId, null) }
        val actions = LinearLayout(context).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.CENTER
            addView(declineButton)
            addView(answerButton)
            addView(endButton)
        }
        column.addView(actions)
        addView(column, LayoutParams(LayoutParams.MATCH_PARENT, LayoutParams.MATCH_PARENT))
    }

    /** Shows the current call (or nothing yet). */
    fun bind(call: TrackedCall?) {
        if (call == null) {
            nameView.text = ""
            numberView.text = ""
            statusView.text = ""
            timerView.visibility = View.GONE
            answerButton.visibility = View.GONE
            declineButton.visibility = View.GONE
            endButton.visibility = View.GONE
            return
        }
        boundCallId = call.id
        nameView.text = call.name ?: if (call.number.isBlank()) "Unknown number" else call.number
        numberView.text = if (call.name != null) call.number else ""
        val ringing = call.incoming && call.state == Call.STATE_RINGING
        answerButton.visibility = if (ringing) View.VISIBLE else View.GONE
        declineButton.visibility = if (ringing) View.VISIBLE else View.GONE
        endButton.visibility = if (ringing || call.state == Call.STATE_DISCONNECTED) View.GONE else View.VISIBLE
        if (call.state == Call.STATE_ACTIVE && call.connectedAtMs > 0) {
            statusView.visibility = View.GONE
            timerView.visibility = View.VISIBLE
            timerView.base = SystemClock.elapsedRealtime() - (System.currentTimeMillis() - call.connectedAtMs).coerceAtLeast(0)
            timerView.start()
        } else {
            timerView.stop()
            timerView.visibility = View.GONE
            statusView.visibility = View.VISIBLE
            statusView.text = when (call.state) {
                Call.STATE_RINGING -> "Incoming call"
                Call.STATE_HOLDING -> "On hold"
                Call.STATE_DISCONNECTING -> "Ending…"
                Call.STATE_DISCONNECTED -> "Call ended"
                else -> "Dialling…"
            }
        }
    }
}
