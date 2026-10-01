package com.employeecalling.calling

import android.content.Context
import android.graphics.Color
import android.graphics.PixelFormat
import android.graphics.Typeface
import android.graphics.drawable.GradientDrawable
import android.os.Build
import android.os.SystemClock
import android.provider.Settings
import android.util.Log
import android.view.Gravity
import android.view.MotionEvent
import android.view.View
import android.view.ViewConfiguration
import android.view.WindowManager
import android.widget.Chronometer
import android.widget.FrameLayout
import android.widget.ImageView
import android.widget.LinearLayout
import android.widget.TextView
import com.employeecalling.R

/** What the floating pill needs to know about the current call. */
class BubbleState(val callId: String, val title: String, val status: String, val connectedAtMs: Long, val active: Boolean)

/**
 * A small draggable pill with the caller, the running time and a hang-up button. It floats above other apps while the call
 * screen is not on top ("Floating Call Bubble" permission = "Display over other apps"). Main thread only.
 */
object FloatingBubble {
    private const val TAG = "FloatingBubble"

    private var root: LinearLayout? = null
    private var titleView: TextView? = null
    private var statusView: TextView? = null
    private var chrono: Chronometer? = null
    private var params: WindowManager.LayoutParams? = null
    private var callId: String? = null

    fun canDraw(ctx: Context): Boolean = Build.VERSION.SDK_INT < 23 || Settings.canDrawOverlays(ctx)

    fun sync(ctx: Context) {
        val appCtx = ctx.applicationContext
        val state = CallManager.bubbleState()
        val wanted = state != null && CallPrefs.bubbleEnabled(appCtx) && !CallManager.isUiVisible() && canDraw(appCtx)
        if (!wanted || state == null) {
            hide(appCtx)
            return
        }
        try {
            if (root == null) create(appCtx)
            update(state)
        } catch (e: Exception) {
            Log.w(TAG, "bubble failed", e)
            hide(appCtx)
        }
    }

    fun hide(ctx: Context) {
        val view = root ?: return
        try {
            chrono?.stop()
            (ctx.applicationContext.getSystemService(Context.WINDOW_SERVICE) as WindowManager).removeViewImmediate(view)
        } catch (e: Exception) {
            Log.w(TAG, "remove failed", e)
        } finally {
            root = null
            titleView = null
            statusView = null
            chrono = null
            params = null
            callId = null
        }
    }

    private fun create(ctx: Context) {
        val wm = ctx.getSystemService(Context.WINDOW_SERVICE) as WindowManager
        val density = ctx.resources.displayMetrics.density
        fun dp(v: Int) = (v * density).toInt()
        val bold = try {
            Typeface.createFromAsset(ctx.assets, "fonts/Poppins-SemiBold.ttf")
        } catch (e: Exception) {
            Typeface.DEFAULT_BOLD
        }
        val regular = try {
            Typeface.createFromAsset(ctx.assets, "fonts/Poppins-Medium.ttf")
        } catch (e: Exception) {
            Typeface.DEFAULT
        }

        val pill = LinearLayout(ctx).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.CENTER_VERTICAL
            setPadding(dp(14), dp(7), dp(7), dp(7))
            background = GradientDrawable().apply {
                setColor(0xFF0C831F.toInt())
                cornerRadius = dp(30).toFloat()
                setStroke(dp(2), 0x40FFFFFF)
            }
            elevation = dp(10).toFloat()
        }

        val icon = ImageView(ctx).apply {
            setImageResource(R.drawable.ic_stat_call)
            layoutParams = LinearLayout.LayoutParams(dp(18), dp(18))
        }

        val texts = LinearLayout(ctx).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(dp(10), 0, dp(12), 0)
        }
        val name = TextView(ctx).apply {
            setTextColor(Color.WHITE)
            textSize = 13f
            typeface = bold
            maxLines = 1
            ellipsize = android.text.TextUtils.TruncateAt.END
            maxWidth = dp(150)
            includeFontPadding = false
        }
        val status = TextView(ctx).apply {
            setTextColor(0xE6FFFFFF.toInt())
            textSize = 11.5f
            typeface = regular
            includeFontPadding = false
        }
        val timer = Chronometer(ctx).apply {
            setTextColor(0xE6FFFFFF.toInt())
            textSize = 11.5f
            typeface = regular
            includeFontPadding = false
            visibility = View.GONE
        }
        texts.addView(name)
        texts.addView(status)
        texts.addView(timer)

        val end = FrameLayout(ctx).apply {
            layoutParams = LinearLayout.LayoutParams(dp(38), dp(38))
            background = GradientDrawable().apply {
                shape = GradientDrawable.OVAL
                setColor(0xFFE23744.toInt())
            }
            val glyph = ImageView(ctx).apply { setImageResource(R.drawable.ic_call_end) }
            addView(glyph, FrameLayout.LayoutParams(dp(20), dp(20), Gravity.CENTER))
            setOnClickListener { CallManager.runAction(ctx, "hangup", callId, null) }
        }

        pill.addView(icon)
        pill.addView(texts)
        pill.addView(end)

        val type = if (Build.VERSION.SDK_INT >= 26) {
            WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY
        } else {
            @Suppress("DEPRECATION")
            WindowManager.LayoutParams.TYPE_PHONE
        }
        val lp = WindowManager.LayoutParams(
            WindowManager.LayoutParams.WRAP_CONTENT,
            WindowManager.LayoutParams.WRAP_CONTENT,
            type,
            WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE or WindowManager.LayoutParams.FLAG_LAYOUT_NO_LIMITS,
            PixelFormat.TRANSLUCENT,
        ).apply {
            gravity = Gravity.TOP or Gravity.START
            x = dp(12)
            y = dp(110)
        }

        // drag to move, tap to return to the call screen
        val slop = ViewConfiguration.get(ctx).scaledTouchSlop
        var startX = 0
        var startY = 0
        var touchX = 0f
        var touchY = 0f
        var moved = false
        pill.setOnTouchListener { _, event ->
            when (event.action) {
                MotionEvent.ACTION_DOWN -> {
                    startX = lp.x
                    startY = lp.y
                    touchX = event.rawX
                    touchY = event.rawY
                    moved = false
                    true
                }
                MotionEvent.ACTION_MOVE -> {
                    val dx = (event.rawX - touchX).toInt()
                    val dy = (event.rawY - touchY).toInt()
                    if (!moved && (Math.abs(dx) > slop || Math.abs(dy) > slop)) moved = true
                    if (moved) {
                        lp.x = startX + dx
                        lp.y = startY + dy
                        try {
                            wm.updateViewLayout(pill, lp)
                        } catch (e: Exception) {
                            // view already removed
                        }
                    }
                    true
                }
                MotionEvent.ACTION_UP -> {
                    if (!moved) CallManager.showUi(ctx)
                    true
                }
                else -> false
            }
        }

        wm.addView(pill, lp)
        root = pill
        titleView = name
        statusView = status
        chrono = timer
        params = lp
    }

    private fun update(state: BubbleState) {
        callId = state.callId
        titleView?.text = state.title
        val timer = chrono ?: return
        val status = statusView ?: return
        if (state.active && state.connectedAtMs > 0) {
            status.visibility = View.GONE
            timer.visibility = View.VISIBLE
            timer.base = SystemClock.elapsedRealtime() - (System.currentTimeMillis() - state.connectedAtMs).coerceAtLeast(0)
            timer.start()
        } else {
            timer.stop()
            timer.visibility = View.GONE
            status.visibility = View.VISIBLE
            status.text = state.status
        }
    }
}
