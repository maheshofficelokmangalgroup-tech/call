package com.employeecalling.calling

import android.Manifest
import android.app.Activity
import android.app.NotificationManager
import android.app.role.RoleManager
import android.content.ActivityNotFoundException
import android.content.ContentUris
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.os.PowerManager
import android.provider.CallLog
import android.provider.MediaStore
import android.provider.Settings
import android.telecom.PhoneAccount
import android.telecom.PhoneAccountHandle
import android.telecom.TelecomManager
import android.telephony.PhoneNumberUtils
import android.telephony.PhoneStateListener
import android.telephony.TelephonyCallback
import android.telephony.TelephonyManager
import androidx.core.content.ContextCompat
import com.employeecalling.BuildConfig
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.BaseActivityEventListener
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.bridge.WritableMap
import com.facebook.react.module.annotations.ReactModule
import java.io.File
import java.util.concurrent.Executors

/**
 * Telephony bridge for the employee app.
 *
 * Two ways of making a call, both documented in docs/TELEPHONY.md:
 *  1. The phone's own dialer (ACTION_CALL). Works everywhere with no setup; this module tracks the phone state, reads the call
 *     log afterwards and (when recording is enabled) locates the file produced by the device's call recorder.
 *  2. This app as the phone app (default dialer, optional). AppInCallService/CallManager then own the call screen, the controls
 *     (mute, hold, speaker, keypad), the notification, the floating bubble and the microphone recording.
 */
@ReactModule(name = CallingModule.NAME)
class CallingModule(private val reactContext: ReactApplicationContext) : ReactContextBaseJavaModule(reactContext) {

    companion object {
        const val NAME = "CallingModule"
        private const val REQ_DEFAULT_DIALER = 7311
        private val RECORDING_PATH_HINT = Regex("call|record|rec|voice", RegexOption.IGNORE_CASE)
    }

    private val io = Executors.newSingleThreadExecutor()
    private var telephonyCallback: Any? = null // TelephonyCallback (API 31+)
    private var legacyListener: Any? = null // PhoneStateListener (API < 31)
    private var rolePromise: Promise? = null

    private val activityListener = object : BaseActivityEventListener() {
        override fun onActivityResult(activity: Activity, requestCode: Int, resultCode: Int, data: Intent?) {
            if (requestCode != REQ_DEFAULT_DIALER) return
            val pending = rolePromise
            rolePromise = null
            pending?.resolve(CallManager.isDefaultDialer(reactContext))
        }
    }

    init {
        reactContext.addActivityEventListener(activityListener)
    }

    override fun getName() = NAME

    /** Build-time values JavaScript needs before anything else (the server address the APK was built for). */
    override fun getConstants(): MutableMap<String, Any> = hashMapOf("defaultApiUrl" to BuildConfig.DEFAULT_API_URL)

    override fun initialize() {
        super.initialize()
        PhoneEvents.reactContext = reactContext
    }

    override fun invalidate() {
        stopListeningInternal()
        reactContext.removeActivityEventListener(activityListener)
        if (PhoneEvents.reactContext === reactContext) PhoneEvents.reactContext = null
        io.shutdown()
        super.invalidate()
    }

    private fun granted(permission: String) =
        ContextCompat.checkSelfPermission(reactContext, permission) == PackageManager.PERMISSION_GRANTED

    private fun audioPermission() =
        if (Build.VERSION.SDK_INT >= 33) Manifest.permission.READ_MEDIA_AUDIO else Manifest.permission.READ_EXTERNAL_STORAGE

    private fun telephonyManager() = reactContext.getSystemService(Context.TELEPHONY_SERVICE) as? TelephonyManager

    private fun telecom() = reactContext.getSystemService(Context.TELECOM_SERVICE) as TelecomManager

    private fun putNullableBoolean(map: WritableMap, key: String, value: Boolean?) {
        if (value == null) map.putNull(key) else map.putBoolean(key, value)
    }

    // ------------------------------------------------------------------------------------ info
    @ReactMethod
    fun getCapabilities(promise: Promise) {
        try {
            val pm = reactContext.packageManager
            val tm = telephonyManager()
            val map = Arguments.createMap()
            map.putInt("sdkInt", Build.VERSION.SDK_INT)
            map.putString("androidRelease", Build.VERSION.RELEASE)
            map.putString("manufacturer", Build.MANUFACTURER)
            map.putString("model", Build.MODEL)
            map.putBoolean("hasTelephony", pm.hasSystemFeature(PackageManager.FEATURE_TELEPHONY))
            map.putString("simState", simStateName(tm?.simState ?: TelephonyManager.SIM_STATE_UNKNOWN))
            map.putString("networkOperator", tm?.networkOperatorName)
            val perms = Arguments.createMap()
            perms.putBoolean("callPhone", granted(Manifest.permission.CALL_PHONE))
            perms.putBoolean("readPhoneState", granted(Manifest.permission.READ_PHONE_STATE))
            perms.putBoolean("readCallLog", granted(Manifest.permission.READ_CALL_LOG))
            perms.putBoolean("answerPhoneCalls", granted(Manifest.permission.ANSWER_PHONE_CALLS))
            perms.putBoolean("readAudio", granted(audioPermission()))
            perms.putBoolean("postNotifications", Build.VERSION.SDK_INT < 33 || granted(Manifest.permission.POST_NOTIFICATIONS))
            perms.putBoolean("readContacts", granted(Manifest.permission.READ_CONTACTS))
            perms.putBoolean("recordAudio", granted(Manifest.permission.RECORD_AUDIO))
            map.putMap("permissions", perms)
            map.putString("defaultDialer", try {
                telecom().defaultDialerPackage
            } catch (e: Exception) {
                null
            })
            map.putBoolean("isDefaultDialer", CallManager.isDefaultDialer(reactContext))
            promise.resolve(map)
        } catch (e: Exception) {
            promise.reject("CAPABILITIES_FAILED", e.message, e)
        }
    }

    @ReactMethod
    fun getDeviceInfo(promise: Promise) {
        try {
            val map = Arguments.createMap()
            val androidId = Settings.Secure.getString(reactContext.contentResolver, Settings.Secure.ANDROID_ID)
            map.putString("deviceUid", "android-" + (androidId ?: "unknown"))
            map.putString("manufacturer", Build.MANUFACTURER)
            map.putString("model", Build.MODEL)
            map.putString("osVersion", "Android ${Build.VERSION.RELEASE} (API ${Build.VERSION.SDK_INT})")
            val pkg = reactContext.packageManager.getPackageInfo(reactContext.packageName, 0)
            map.putString("appVersion", pkg.versionName ?: "1.0")
            promise.resolve(map)
        } catch (e: Exception) {
            promise.reject("DEVICE_INFO_FAILED", e.message, e)
        }
    }

    private fun simStateName(state: Int) = when (state) {
        TelephonyManager.SIM_STATE_READY -> "READY"
        TelephonyManager.SIM_STATE_ABSENT -> "ABSENT"
        TelephonyManager.SIM_STATE_PIN_REQUIRED -> "PIN_REQUIRED"
        TelephonyManager.SIM_STATE_PUK_REQUIRED -> "PUK_REQUIRED"
        TelephonyManager.SIM_STATE_NETWORK_LOCKED -> "NETWORK_LOCKED"
        TelephonyManager.SIM_STATE_NOT_READY -> "NOT_READY"
        TelephonyManager.SIM_STATE_PERM_DISABLED -> "PERM_DISABLED"
        TelephonyManager.SIM_STATE_CARD_IO_ERROR -> "CARD_IO_ERROR"
        TelephonyManager.SIM_STATE_CARD_RESTRICTED -> "CARD_RESTRICTED"
        else -> "UNKNOWN"
    }

    // ------------------------------------------------------------------------- phone setup (permissions)
    /** Everything the setup screen cannot learn from PermissionsAndroid: roles, overlay, battery, and the maker-specific switches. */
    @ReactMethod
    fun getSetupStatus(promise: Promise) {
        try {
            val map = Arguments.createMap()
            map.putBoolean("isDefaultDialer", CallManager.isDefaultDialer(reactContext))
            map.putBoolean("dialerRoleAvailable", dialerRoleAvailable())
            map.putBoolean("overlay", FloatingBubble.canDraw(reactContext))
            val power = reactContext.getSystemService(Context.POWER_SERVICE) as PowerManager
            map.putBoolean("batteryUnrestricted", Build.VERSION.SDK_INT < 23 || power.isIgnoringBatteryOptimizations(reactContext.packageName))
            val notifications = reactContext.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
            map.putBoolean("fullScreenApplicable", Build.VERSION.SDK_INT >= 34)
            map.putBoolean("fullScreenAllowed", Build.VERSION.SDK_INT < 34 || notifications.canUseFullScreenIntent())
            map.putBoolean("isXiaomi", OemSettings.isXiaomi())
            map.putBoolean("needsAutostart", OemSettings.needsAutostart())
            putNullableBoolean(map, "miuiLockScreen", OemSettings.miuiShowOnLockScreen(reactContext))
            putNullableBoolean(map, "miuiPopups", OemSettings.miuiBackgroundPopups(reactContext))
            map.putString("manufacturer", Build.MANUFACTURER)
            map.putString("model", Build.MODEL)
            promise.resolve(map)
        } catch (e: Exception) {
            promise.reject("SETUP_STATUS_FAILED", e.message, e)
        }
    }

    private fun dialerRoleAvailable(): Boolean {
        if (Build.VERSION.SDK_INT < 29) return true
        return try {
            reactContext.getSystemService(RoleManager::class.java)?.isRoleAvailable(RoleManager.ROLE_DIALER) ?: false
        } catch (e: Exception) {
            false
        }
    }

    private fun startSettings(intent: Intent): Boolean {
        return try {
            val activity = reactContext.currentActivity
            if (activity != null) {
                activity.startActivity(intent)
            } else {
                intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
                reactContext.startActivity(intent)
            }
            true
        } catch (e: Exception) {
            false
        }
    }

    @ReactMethod
    fun openSetting(kind: String, promise: Promise) {
        val ctx: Context = reactContext.currentActivity ?: reactContext
        val pkg = reactContext.packageName
        val opened = when (kind) {
            "overlay" -> startSettings(Intent(Settings.ACTION_MANAGE_OVERLAY_PERMISSION, Uri.parse("package:$pkg")))
            "battery" -> Build.VERSION.SDK_INT >= 23 &&
                (startSettings(Intent(Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS, Uri.parse("package:$pkg"))) ||
                    startSettings(Intent(Settings.ACTION_IGNORE_BATTERY_OPTIMIZATION_SETTINGS)))
            "batterySaver" -> OemSettings.openMiuiBatterySaver(ctx)
            "fullScreen" -> Build.VERSION.SDK_INT >= 34 && startSettings(Intent(Settings.ACTION_MANAGE_APP_USE_FULL_SCREEN_INTENT, Uri.parse("package:$pkg")))
            "miuiPermissions" -> OemSettings.openMiuiPermissionEditor(ctx)
            "autostart" -> OemSettings.openAutostart(ctx)
            "appDetails" -> OemSettings.openAppDetails(ctx)
            "defaultApps" -> startSettings(Intent(Settings.ACTION_MANAGE_DEFAULT_APPS_SETTINGS))
            "notifications" -> startSettings(Intent(Settings.ACTION_APP_NOTIFICATION_SETTINGS).putExtra(Settings.EXTRA_APP_PACKAGE, pkg))
            else -> false
        }
        promise.resolve(opened)
    }

    /** Asks the system to make this app the phone app (a system dialog; resolves with whether it was granted). */
    @ReactMethod
    fun requestDefaultDialer(promise: Promise) {
        if (CallManager.isDefaultDialer(reactContext)) {
            promise.resolve(true)
            return
        }
        val activity = reactContext.currentActivity
        if (activity == null) {
            promise.reject("NO_ACTIVITY", "Open the app first")
            return
        }
        if (rolePromise != null) {
            promise.reject("BUSY", "A request is already open")
            return
        }
        try {
            val intent: Intent = if (Build.VERSION.SDK_INT >= 29) {
                val roles = reactContext.getSystemService(RoleManager::class.java)
                if (roles == null || !roles.isRoleAvailable(RoleManager.ROLE_DIALER)) {
                    promise.reject("UNAVAILABLE", "This phone does not allow changing the phone app")
                    return
                }
                roles.createRequestRoleIntent(RoleManager.ROLE_DIALER)
            } else {
                Intent(TelecomManager.ACTION_CHANGE_DEFAULT_DIALER)
                    .putExtra(TelecomManager.EXTRA_CHANGE_DEFAULT_DIALER_PACKAGE_NAME, reactContext.packageName)
            }
            rolePromise = promise
            activity.startActivityForResult(intent, REQ_DEFAULT_DIALER)
        } catch (e: Exception) {
            rolePromise = null
            promise.reject("REQUEST_FAILED", e.message, e)
        }
    }

    // ------------------------------------------------------------------------------------- SIM cards
    private fun simHandles(): List<PhoneAccountHandle> {
        val all = telecom().callCapablePhoneAccounts
        val sims = all.filter { handle ->
            telecom().getPhoneAccount(handle)?.hasCapabilities(PhoneAccount.CAPABILITY_SIM_SUBSCRIPTION) == true
        }
        return sims.ifEmpty { all }
    }

    @ReactMethod
    fun getSimAccounts(promise: Promise) {
        val out = Arguments.createArray()
        if (!granted(Manifest.permission.READ_PHONE_STATE)) {
            promise.resolve(out)
            return
        }
        try {
            val default = telecom().getDefaultOutgoingPhoneAccount(PhoneAccount.SCHEME_TEL)
            for ((index, handle) in simHandles().withIndex()) {
                val account = telecom().getPhoneAccount(handle) ?: continue
                val row = Arguments.createMap()
                row.putString("id", CallManager.handleKey(handle))
                row.putString("label", account.label?.toString()?.takeIf { it.isNotBlank() } ?: "SIM ${index + 1}")
                row.putString("number", account.address?.schemeSpecificPart)
                row.putInt("slot", index + 1)
                row.putBoolean("isDefault", default == handle)
                out.pushMap(row)
            }
            promise.resolve(out)
        } catch (e: SecurityException) {
            promise.resolve(Arguments.createArray())
        } catch (e: Exception) {
            promise.reject("SIM_LIST_FAILED", e.message, e)
        }
    }

    // ---------------------------------------------------------------------------------- calling
    @ReactMethod
    fun placeCall(number: String, sessionId: String, accountKey: String?, promise: Promise) {
        if (!granted(Manifest.permission.CALL_PHONE)) {
            promise.reject("NO_PERMISSION", "Phone permission has not been granted")
            return
        }
        if (!reactContext.packageManager.hasSystemFeature(PackageManager.FEATURE_TELEPHONY)) {
            promise.reject("NO_TELEPHONY", "This device cannot place phone calls")
            return
        }
        val cleaned = number.filter { it.isDigit() || it == '+' }
        if (cleaned.filter { it.isDigit() }.length < 5) {
            promise.reject("INVALID_NUMBER", "The phone number is not valid")
            return
        }
        val startedAt = System.currentTimeMillis()
        CallSessionStore.begin(reactContext, sessionId, cleaned, startedAt)
        val intent = Intent(Intent.ACTION_CALL, Uri.fromParts("tel", cleaned, null))
        if (!accountKey.isNullOrBlank() && granted(Manifest.permission.READ_PHONE_STATE)) {
            try {
                simHandles().firstOrNull { CallManager.handleKey(it) == accountKey }?.let {
                    intent.putExtra(TelecomManager.EXTRA_PHONE_ACCOUNT_HANDLE, it)
                }
            } catch (e: Exception) {
                // the chosen SIM is no longer there: let the phone decide
            }
        }
        try {
            val activity = reactContext.currentActivity
            if (activity != null) {
                activity.startActivity(intent)
            } else {
                intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
                reactContext.startActivity(intent)
            }
            val result = Arguments.createMap()
            result.putDouble("startedAtMs", startedAt.toDouble())
            promise.resolve(result)
        } catch (e: SecurityException) {
            CallSessionStore.clear(reactContext, sessionId)
            promise.reject("NO_PERMISSION", e.message, e)
        } catch (e: ActivityNotFoundException) {
            CallSessionStore.clear(reactContext, sessionId)
            promise.reject("NO_DIALER", "No phone app is available on this device", e)
        } catch (e: Exception) {
            CallSessionStore.clear(reactContext, sessionId)
            promise.reject("PLACE_CALL_FAILED", e.message, e)
        }
    }

    /** Is this an emergency number (112, 100, 108, 911...) according to the phone's own list for the SIM's country? */
    @ReactMethod
    fun isEmergencyNumber(number: String, promise: Promise) {
        try {
            val digits = number.filter { it.isDigit() }
            val emergency = if (digits.length < 2) {
                false
            } else if (Build.VERSION.SDK_INT >= 29) {
                telephonyManager()?.isEmergencyNumber(digits) ?: false
            } else {
                @Suppress("DEPRECATION")
                PhoneNumberUtils.isEmergencyNumber(digits)
            }
            promise.resolve(emergency)
        } catch (e: Exception) {
            promise.resolve(false)
        }
    }

    /**
     * Emergency numbers and service codes (*#06#, *123#) are placed by the phone itself: no CRM session, no recording, and
     * nothing is altered (placeCall above strips everything but digits, which would turn *123# into a call to 123).
     * A phone app must always be able to place an emergency call, so this works whether or not this app is the phone app.
     */
    @ReactMethod
    fun placePlainCall(number: String, promise: Promise) {
        if (!granted(Manifest.permission.CALL_PHONE)) {
            promise.reject("NO_PERMISSION", "Phone permission has not been granted")
            return
        }
        val cleaned = number.filter { it.isDigit() || it == '+' || it == '*' || it == '#' }
        if (cleaned.isEmpty()) {
            promise.reject("INVALID_NUMBER", "The number is not valid")
            return
        }
        try {
            val uri = Uri.fromParts("tel", cleaned, null)
            val digits = cleaned.filter { it.isDigit() }
            val emergency = !cleaned.contains('*') && !cleaned.contains('#') && digits.length >= 2 &&
                if (Build.VERSION.SDK_INT >= 29) telephonyManager()?.isEmergencyNumber(digits) == true else false
            if (emergency) {
                telecom().placeCall(uri, Bundle())
            } else {
                val intent = Intent(Intent.ACTION_CALL, uri)
                val activity = reactContext.currentActivity
                if (activity != null) {
                    activity.startActivity(intent)
                } else {
                    intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
                    reactContext.startActivity(intent)
                }
            }
            promise.resolve(true)
        } catch (e: SecurityException) {
            promise.reject("NO_PERMISSION", e.message, e)
        } catch (e: Exception) {
            promise.reject("PLACE_CALL_FAILED", e.message, e)
        }
    }

    @ReactMethod
    fun endCall(promise: Promise) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.P) {
            promise.reject("UNSUPPORTED", "Ending a call from the app needs Android 9 or newer")
            return
        }
        if (!granted(Manifest.permission.ANSWER_PHONE_CALLS)) {
            promise.reject("NO_PERMISSION", "Permission to end calls has not been granted")
            return
        }
        try {
            @Suppress("DEPRECATION")
            promise.resolve(telecom().endCall())
        } catch (e: Exception) {
            promise.reject("END_CALL_FAILED", e.message, e)
        }
    }

    // --------------------------------------------------------------- phone-app mode: live call control
    /** JSON of every live call plus audio state (see CallManager.buildSnapshot). */
    @ReactMethod
    fun getCallSnapshot(promise: Promise) {
        promise.resolve(CallManager.snapshot(reactContext))
    }

    /** answer | reject | hangup | hold | unhold | swap | mute(arg true/false) | route(arg) | dtmf(arg digit) | selectSim(arg) | closeUi(arg main) */
    @ReactMethod
    fun callAction(action: String, callId: String?, arg: String?, promise: Promise) {
        CallManager.runAction(reactContext, action, callId, arg)
        promise.resolve(true)
    }

    /** The React call UI is on screen: the native fallback can go. */
    @ReactMethod
    fun inCallUiReady() {
        val activity = InCallActivity.current ?: return
        activity.runOnUiThread { activity.hideFallback() }
    }

    @ReactMethod
    fun setCallDisplay(callId: String, name: String?, subtitle: String?) {
        CallManager.setDisplay(callId, name, subtitle)
    }

    @ReactMethod
    fun setRecordingEnabled(enabled: Boolean) {
        CallPrefs.setRecordingEnabled(reactContext, enabled)
    }

    @ReactMethod
    fun setBubbleEnabled(enabled: Boolean) {
        CallPrefs.setBubbleEnabled(reactContext, enabled)
    }

    @ReactMethod
    fun takePendingDial(promise: Promise) {
        val number = PhoneEvents.pendingDial
        PhoneEvents.pendingDial = null
        promise.resolve(number)
    }

    @ReactMethod
    fun lookupContactName(number: String, promise: Promise) {
        io.execute {
            promise.resolve(CallManager.lookupName(reactContext, number))
        }
    }

    // Only files the app itself created (recordings) may be touched through these two.
    private fun ownFile(path: String): File? {
        val file = File(path)
        val root = reactContext.filesDir.canonicalPath
        return if (file.canonicalPath.startsWith(root + File.separator)) file else null
    }

    @ReactMethod
    fun getFileInfo(path: String, promise: Promise) {
        val file = try {
            ownFile(path)
        } catch (e: Exception) {
            null
        }
        val map = Arguments.createMap()
        map.putBoolean("exists", file?.exists() == true)
        map.putDouble("size", (file?.takeIf { it.exists() }?.length() ?: 0L).toDouble())
        promise.resolve(map)
    }

    @ReactMethod
    fun deleteFile(path: String, promise: Promise) {
        try {
            promise.resolve(ownFile(path)?.delete() ?: false)
        } catch (e: Exception) {
            promise.resolve(false)
        }
    }

    // -------------------------------------------------------------------------------- session
    private fun sessionToMap(session: org.json.JSONObject): WritableMap {
        val map = Arguments.createMap()
        map.putString("id", session.optString("id"))
        map.putString("number", session.optString("number"))
        map.putDouble("startedAtMs", session.optLong("startedAtMs").toDouble())
        fun timestamp(key: String) {
            if (session.isNull(key)) map.putNull(key) else map.putDouble(key, session.getLong(key).toDouble())
        }
        timestamp("offhookAtMs")
        timestamp("endedAtMs")
        timestamp("answeredAtMs")
        map.putString("source", session.optString("source", "phone"))
        map.putInt("causeCode", session.optInt("causeCode", -1))
        if (session.isNull("causeReason")) map.putNull("causeReason") else map.putString("causeReason", session.optString("causeReason"))
        if (session.isNull("recordingStatus")) map.putNull("recordingStatus") else map.putString("recordingStatus", session.optString("recordingStatus"))
        if (session.isNull("recordingPath")) map.putNull("recordingPath") else map.putString("recordingPath", session.optString("recordingPath"))
        map.putDouble("recordingDurationMs", session.optLong("recordingDurationMs").toDouble())
        if (session.isNull("recordingDetail")) map.putNull("recordingDetail") else map.putString("recordingDetail", session.optString("recordingDetail"))
        return map
    }

    @ReactMethod
    fun getActiveSession(promise: Promise) {
        val session = CallSessionStore.current(reactContext)
        if (session == null) promise.resolve(null) else promise.resolve(sessionToMap(session))
    }

    @ReactMethod
    fun clearSession(sessionId: String?, promise: Promise) {
        CallSessionStore.clear(reactContext, sessionId)
        promise.resolve(true)
    }

    @ReactMethod
    fun getPhoneState(promise: Promise) {
        try {
            if (!granted(Manifest.permission.READ_PHONE_STATE) && Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
                promise.resolve("UNKNOWN")
                return
            }
            @Suppress("DEPRECATION")
            val state = telephonyManager()?.callState ?: TelephonyManager.CALL_STATE_IDLE
            promise.resolve(callStateName(state))
        } catch (e: Exception) {
            promise.resolve("UNKNOWN")
        }
    }

    private fun callStateName(state: Int) = when (state) {
        TelephonyManager.CALL_STATE_RINGING -> "RINGING"
        TelephonyManager.CALL_STATE_OFFHOOK -> "OFFHOOK"
        else -> "IDLE"
    }

    // ---------------------------------------------------------------- phone-state listener
    /** In-process listener; complements the manifest receiver and is more reliable on some manufacturers. */
    @ReactMethod
    fun startListening(promise: Promise) {
        try {
            if (telephonyCallback != null || legacyListener != null) {
                promise.resolve(true)
                return
            }
            if (!granted(Manifest.permission.READ_PHONE_STATE)) {
                promise.resolve(false)
                return
            }
            val tm = telephonyManager()
            if (tm == null) {
                promise.resolve(false)
                return
            }
            val appCtx = reactContext.applicationContext
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
                val callback = object : TelephonyCallback(), TelephonyCallback.CallStateListener {
                    override fun onCallStateChanged(state: Int) {
                        CallStateTracker.handle(appCtx, callStateName(state), System.currentTimeMillis())
                    }
                }
                tm.registerTelephonyCallback(ContextCompat.getMainExecutor(reactContext), callback)
                telephonyCallback = callback
            } else {
                @Suppress("DEPRECATION")
                val listener = object : PhoneStateListener() {
                    @Deprecated("Deprecated in Java")
                    override fun onCallStateChanged(state: Int, phoneNumber: String?) {
                        CallStateTracker.handle(appCtx, callStateName(state), System.currentTimeMillis())
                    }
                }
                @Suppress("DEPRECATION")
                tm.listen(listener, PhoneStateListener.LISTEN_CALL_STATE)
                legacyListener = listener
            }
            promise.resolve(true)
        } catch (e: Exception) {
            promise.reject("LISTEN_FAILED", e.message, e)
        }
    }

    @ReactMethod
    fun stopListening(promise: Promise) {
        stopListeningInternal()
        promise.resolve(true)
    }

    private fun stopListeningInternal() {
        try {
            val tm = telephonyManager() ?: return
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
                (telephonyCallback as? TelephonyCallback)?.let { tm.unregisterTelephonyCallback(it) }
            } else {
                @Suppress("DEPRECATION")
                (legacyListener as? PhoneStateListener)?.let { tm.listen(it, PhoneStateListener.LISTEN_NONE) }
            }
        } catch (e: Exception) {
            // nothing to clean up
        } finally {
            telephonyCallback = null
            legacyListener = null
        }
    }

    // ----------------------------------------------------------------------------- call log
    /**
     * Finds the most recent outgoing call log entry for [number] that started at/after [sinceMs].
     * Resolves {found:false} until Android has written the entry (it can lag a second or two after hang-up).
     */
    @ReactMethod
    fun readCallLog(number: String, sinceMs: Double, promise: Promise) {
        if (!granted(Manifest.permission.READ_CALL_LOG)) {
            promise.reject("NO_PERMISSION", "Call log permission has not been granted")
            return
        }
        io.execute {
            try {
                val digits = number.filter { it.isDigit() }
                val suffix = if (digits.length > 10) digits.takeLast(10) else digits
                val since = sinceMs.toLong() - 15_000
                val projection = arrayOf(
                    CallLog.Calls._ID, CallLog.Calls.NUMBER, CallLog.Calls.DATE, CallLog.Calls.DURATION, CallLog.Calls.TYPE,
                )
                val result = Arguments.createMap()
                result.putBoolean("found", false)
                reactContext.contentResolver.query(
                    CallLog.Calls.CONTENT_URI,
                    projection,
                    "${CallLog.Calls.DATE} >= ? AND ${CallLog.Calls.TYPE} = ?",
                    arrayOf(since.toString(), CallLog.Calls.OUTGOING_TYPE.toString()),
                    "${CallLog.Calls.DATE} DESC",
                )?.use { cursor ->
                    while (cursor.moveToNext()) {
                        val rowDigits = (cursor.getString(1) ?: "").filter { it.isDigit() }
                        if (suffix.isNotEmpty() && !rowDigits.endsWith(suffix)) continue
                        result.putBoolean("found", true)
                        result.putDouble("id", cursor.getLong(0).toDouble())
                        result.putDouble("dateMs", cursor.getLong(2).toDouble())
                        result.putInt("durationSec", cursor.getInt(3))
                        break
                    }
                }
                promise.resolve(result)
            } catch (e: Exception) {
                promise.reject("CALL_LOG_FAILED", e.message, e)
            }
        }
    }

    // ---------------------------------------------------------------------------- recordings
    /**
     * Looks for an audio file added to the device's media library during the call window whose folder/name looks like a
     * call recording (Samsung, Xiaomi, Oppo, Vivo, Realme, Google Recorder... all write to "Call"/"Recordings" folders).
     * Returns null when nothing is found - the platform never pretends a recording exists.
     */
    @ReactMethod
    fun findRecentRecording(startedAtMs: Double, endedAtMs: Double, promise: Promise) {
        if (!granted(audioPermission())) {
            promise.reject("NO_PERMISSION", "Audio/media permission has not been granted")
            return
        }
        io.execute {
            try {
                val fromSec = (startedAtMs.toLong() / 1000) - 10
                val toSec = (endedAtMs.toLong() / 1000) + 120
                val uri = MediaStore.Audio.Media.EXTERNAL_CONTENT_URI
                val projection = mutableListOf(
                    MediaStore.Audio.Media._ID,
                    MediaStore.Audio.Media.DISPLAY_NAME,
                    MediaStore.Audio.Media.MIME_TYPE,
                    MediaStore.Audio.Media.SIZE,
                    MediaStore.Audio.Media.DATE_ADDED,
                    MediaStore.Audio.Media.DATE_MODIFIED,
                    MediaStore.Audio.Media.DURATION,
                )
                val hasRelativePath = Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q
                if (hasRelativePath) projection.add(MediaStore.Audio.Media.RELATIVE_PATH)

                var best: WritableMap? = null
                var bestDistance = Long.MAX_VALUE
                reactContext.contentResolver.query(
                    uri,
                    projection.toTypedArray(),
                    "(${MediaStore.Audio.Media.DATE_ADDED} >= ? OR ${MediaStore.Audio.Media.DATE_MODIFIED} >= ?) AND ${MediaStore.Audio.Media.SIZE} > 0",
                    arrayOf(fromSec.toString(), fromSec.toString()),
                    "${MediaStore.Audio.Media.DATE_ADDED} DESC",
                )?.use { cursor ->
                    var scanned = 0
                    while (cursor.moveToNext() && scanned < 60) {
                        scanned++
                        val name = cursor.getString(1) ?: ""
                        val relativePath = if (hasRelativePath) (cursor.getString(7) ?: "") else ""
                        if (!RECORDING_PATH_HINT.containsMatchIn(name) && !RECORDING_PATH_HINT.containsMatchIn(relativePath)) continue
                        val addedSec = cursor.getLong(4)
                        val modifiedSec = cursor.getLong(5)
                        val stamp = maxOf(addedSec, modifiedSec)
                        if (stamp < fromSec || stamp > toSec + 600) continue
                        val distance = Math.abs(stamp * 1000 - endedAtMs.toLong())
                        if (distance < bestDistance) {
                            bestDistance = distance
                            val map = Arguments.createMap()
                            map.putString("uri", ContentUris.withAppendedId(uri, cursor.getLong(0)).toString())
                            map.putString("displayName", name)
                            map.putString("mimeType", cursor.getString(2) ?: "audio/mp4")
                            map.putDouble("sizeBytes", cursor.getLong(3).toDouble())
                            map.putDouble("dateAddedMs", addedSec * 1000.0)
                            map.putDouble("durationMs", cursor.getLong(6).toDouble())
                            map.putString("relativePath", relativePath)
                            best = map
                        }
                    }
                }
                promise.resolve(best)
            } catch (e: Exception) {
                promise.reject("RECORDING_SCAN_FAILED", e.message, e)
            }
        }
    }

    /** Lists the newest audio files (name + folder) so the diagnostics screen can show where recordings end up. */
    @ReactMethod
    fun listRecentAudio(limit: Int, promise: Promise) {
        if (!granted(audioPermission())) {
            promise.reject("NO_PERMISSION", "Audio/media permission has not been granted")
            return
        }
        io.execute {
            try {
                val out = Arguments.createArray()
                val hasRelativePath = Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q
                val projection = mutableListOf(MediaStore.Audio.Media.DISPLAY_NAME, MediaStore.Audio.Media.DATE_ADDED, MediaStore.Audio.Media.SIZE)
                if (hasRelativePath) projection.add(MediaStore.Audio.Media.RELATIVE_PATH)
                reactContext.contentResolver.query(
                    MediaStore.Audio.Media.EXTERNAL_CONTENT_URI, projection.toTypedArray(), null, null, "${MediaStore.Audio.Media.DATE_ADDED} DESC",
                )?.use { cursor ->
                    var n = 0
                    while (cursor.moveToNext() && n < limit) {
                        val row = Arguments.createMap()
                        row.putString("name", cursor.getString(0))
                        row.putDouble("addedMs", cursor.getLong(1) * 1000.0)
                        row.putDouble("sizeBytes", cursor.getLong(2).toDouble())
                        row.putString("path", if (hasRelativePath) cursor.getString(3) else null)
                        out.pushMap(row)
                        n++
                    }
                }
                promise.resolve(out)
            } catch (e: Exception) {
                promise.reject("LIST_AUDIO_FAILED", e.message, e)
            }
        }
    }

    // --------------------------------------------------------------------------------- misc
    @ReactMethod
    fun openAppSettings(promise: Promise) {
        try {
            val intent = Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, Uri.fromParts("package", reactContext.packageName, null))
            intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
            reactContext.startActivity(intent)
            promise.resolve(true)
        } catch (e: Exception) {
            promise.reject("OPEN_SETTINGS_FAILED", e.message, e)
        }
    }

    @ReactMethod
    fun openDialer(number: String, promise: Promise) {
        try {
            val intent = Intent(Intent.ACTION_DIAL, Uri.fromParts("tel", number, null))
            intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
            reactContext.startActivity(intent)
            promise.resolve(true)
        } catch (e: Exception) {
            promise.reject("NO_DIALER", e.message, e)
        }
    }

    // Required by NativeEventEmitter; events are delivered through DeviceEventEmitter.
    @ReactMethod
    fun addListener(eventName: String) {
    }

    @ReactMethod
    fun removeListeners(count: Int) {
    }
}
