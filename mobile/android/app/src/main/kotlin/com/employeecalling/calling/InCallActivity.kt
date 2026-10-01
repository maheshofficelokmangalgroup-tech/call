package com.employeecalling.calling

import android.content.Context
import android.content.Intent
import android.os.Build
import android.os.Bundle
import android.util.Log
import android.view.ViewGroup
import android.view.WindowManager
import androidx.core.view.WindowCompat
import com.employeecalling.MainActivity
import com.facebook.react.ReactActivity
import com.facebook.react.ReactActivityDelegate
import com.facebook.react.defaults.DefaultNewArchitectureEntryPoint.fabricEnabled
import com.facebook.react.defaults.DefaultReactActivityDelegate

/**
 * The call screen (incoming and ongoing calls). It is its own task, like a phone app's call screen, and may show above the
 * lock screen. The UI itself is the "InCallRoot" React component; everything it shows comes from CallManager's snapshots.
 */
class InCallActivity : ReactActivity() {

    companion object {
        const val EXTRA_CALL_ID = "callId"
        const val EXTRA_ACTION = "action"

        @Volatile
        var current: InCallActivity? = null

        fun intent(ctx: Context, callId: String?): Intent =
            Intent(ctx, InCallActivity::class.java)
                .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_REORDER_TO_FRONT)
                .apply { if (callId != null) putExtra(EXTRA_CALL_ID, callId) }
    }

    private var fallback: InCallFallbackView? = null

    override fun getMainComponentName(): String = "InCallRoot"

    override fun createReactActivityDelegate(): ReactActivityDelegate =
        DefaultReactActivityDelegate(this, mainComponentName, fabricEnabled)

    override fun onCreate(savedInstanceState: Bundle?) {
        showOverLockScreen()
        super.onCreate(null) // never restore saved state: the call screen is rebuilt from the live call
        current = this
        // the call screen is dark green: white status / navigation bar icons
        WindowCompat.getInsetsController(window, window.decorView).apply {
            isAppearanceLightStatusBars = false
            isAppearanceLightNavigationBars = false
        }
        // A plain native call screen covers the React UI until that has started (see InCallFallbackView)
        fallback = InCallFallbackView(this).also {
            addContentView(it, ViewGroup.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT))
            it.bind(CallManager.callForUi())
        }
        handleIntent(intent)
    }

    /**
     * Back goes to the React UI first (it closes an open note sheet or the keypad); when it does not use the press the call
     * screen is minimised - the call keeps running, the floating bubble / notification bring it back.
     */
    @Suppress("OVERRIDE_DEPRECATION")
    override fun onBackPressed() {
        if (!reactActivityDelegate.onBackPressed()) moveTaskToBack(true)
    }

    /** JavaScript left the Back press alone: minimise instead of closing the call screen. */
    override fun invokeDefaultOnBackPressed() {
        moveTaskToBack(true)
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        setIntent(intent)
        handleIntent(intent)
    }

    /** CallManager calls this whenever the call changes, so the fallback screen stays truthful. */
    fun bindFallback() {
        fallback?.bind(CallManager.callForUi())
    }

    /** The React call UI is on screen: remove the fallback. */
    fun hideFallback() {
        val view = fallback ?: return
        fallback = null
        view.animate().alpha(0f).setDuration(160).withEndAction { (view.parent as? ViewGroup)?.removeView(view) }.start()
    }

    private fun handleIntent(intent: Intent?) {
        if (intent?.getStringExtra(EXTRA_ACTION) == "answer") {
            CallManager.runAction(this, "answer", intent.getStringExtra(EXTRA_CALL_ID), null)
            intent.removeExtra(EXTRA_ACTION)
        }
    }

    private fun showOverLockScreen() {
        if (Build.VERSION.SDK_INT >= 27) {
            setShowWhenLocked(true)
            setTurnScreenOn(true)
        } else {
            @Suppress("DEPRECATION")
            window.addFlags(WindowManager.LayoutParams.FLAG_SHOW_WHEN_LOCKED or WindowManager.LayoutParams.FLAG_TURN_SCREEN_ON)
        }
    }

    override fun onStart() {
        super.onStart()
        CallManager.onUiVisibility(applicationContext, true)
    }

    override fun onStop() {
        CallManager.onUiVisibility(applicationContext, false)
        super.onStop()
    }

    override fun onDestroy() {
        if (current === this) current = null
        super.onDestroy()
    }

    /** Called when the call is over (JavaScript after "Call ended", or CallManager as a safety net). */
    fun closeScreen(toMain: Boolean) {
        if (toMain) {
            try {
                startActivity(Intent(this, MainActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_REORDER_TO_FRONT))
            } catch (e: Exception) {
                Log.w("InCallActivity", "could not return to the app", e)
            }
        }
        finishAndRemoveTask()
    }
}
