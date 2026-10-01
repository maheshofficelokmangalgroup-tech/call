package com.employeecalling.calling

import android.app.Activity
import android.app.AppOpsManager
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.os.Process
import android.provider.Settings
import android.util.Log

/**
 * Device-maker specific permission screens. Xiaomi (MIUI / HyperOS) in particular hides call screens behind extra switches
 * ("Show on lock screen", "Display pop-up windows while running in the background", auto-start) that Android has no API for,
 * so we can only open the right settings page and, where the system allows it, read the switch back.
 */
object OemSettings {
    private const val TAG = "OemSettings"

    // MIUI / HyperOS private app-ops
    private const val OP_SHOW_WHEN_LOCKED = 10020
    private const val OP_BACKGROUND_START_ACTIVITY = 10021

    private val XIAOMI = setOf("xiaomi", "redmi", "poco", "blackshark")
    private val AUTOSTART_MAKERS = setOf("huawei", "honor", "oppo", "realme", "oneplus", "vivo", "iqoo", "asus", "letv", "meizu", "tecno", "infinix", "itel")

    private fun maker(): String = Build.MANUFACTURER.lowercase()

    fun isXiaomi(): Boolean = maker() in XIAOMI || Build.BRAND.lowercase() in XIAOMI

    /** Phones that keep apps asleep until the user lets them "auto-start". */
    fun needsAutostart(): Boolean = isXiaomi() || maker() in AUTOSTART_MAKERS || Build.BRAND.lowercase() in AUTOSTART_MAKERS

    /** Reads a MIUI app-op. Returns null when the phone does not expose it (so the UI can fall back to "open settings"). */
    fun miuiOpAllowed(ctx: Context, op: Int): Boolean? {
        if (!isXiaomi()) return null
        return try {
            val ops = ctx.getSystemService(Context.APP_OPS_SERVICE) as AppOpsManager
            val method = AppOpsManager::class.java.getMethod("checkOpNoThrow", Int::class.javaPrimitiveType, Int::class.javaPrimitiveType, String::class.java)
            val mode = method.invoke(ops, op, Process.myUid(), ctx.packageName) as Int
            mode == AppOpsManager.MODE_ALLOWED
        } catch (e: Throwable) {
            Log.i(TAG, "MIUI op $op not readable: ${e.javaClass.simpleName}")
            null
        }
    }

    fun miuiShowOnLockScreen(ctx: Context): Boolean? = miuiOpAllowed(ctx, OP_SHOW_WHEN_LOCKED)

    fun miuiBackgroundPopups(ctx: Context): Boolean? = miuiOpAllowed(ctx, OP_BACKGROUND_START_ACTIVITY)

    private fun tryStart(ctx: Context, intent: Intent): Boolean {
        return try {
            if (ctx !is Activity) intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
            ctx.startActivity(intent)
            true
        } catch (e: Exception) {
            false
        }
    }

    fun openAppDetails(ctx: Context): Boolean =
        tryStart(ctx, Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, Uri.fromParts("package", ctx.packageName, null)))

    /** MIUI's per-app permission editor (lock screen / pop-up / autostart live here on most versions). */
    fun openMiuiPermissionEditor(ctx: Context): Boolean {
        val pkg = ctx.packageName
        val classes = listOf(
            "com.miui.permcenter.permissions.PermissionsEditorActivity",
            "com.miui.permcenter.permissions.AppPermissionsEditorActivity",
        )
        for (cls in classes) {
            val intent = Intent("miui.intent.action.APP_PERM_EDITOR").setClassName("com.miui.securitycenter", cls).putExtra("extra_pkgname", pkg)
            if (tryStart(ctx, intent)) return true
        }
        if (tryStart(ctx, Intent("miui.intent.action.APP_PERM_EDITOR").putExtra("extra_pkgname", pkg))) return true
        return openAppDetails(ctx)
    }

    /** The "auto-start" list of the phone maker; falls back to the app's settings page. */
    fun openAutostart(ctx: Context): Boolean {
        val candidates = listOf(
            "com.miui.securitycenter" to "com.miui.permcenter.autostart.AutoStartManagementActivity",
            "com.huawei.systemmanager" to "com.huawei.systemmanager.startupmgr.ui.StartupNormalAppListActivity",
            "com.huawei.systemmanager" to "com.huawei.systemmanager.optimize.process.ProtectActivity",
            "com.coloros.safecenter" to "com.coloros.safecenter.permission.startup.StartupAppListActivity",
            "com.oppo.safe" to "com.oppo.safe.permission.startup.StartupAppListActivity",
            "com.vivo.permissionmanager" to "com.vivo.permissionmanager.activity.BgStartUpManagerActivity",
            "com.iqoo.secure" to "com.iqoo.secure.ui.phoneoptimize.AddWhiteListActivity",
            "com.asus.mobilemanager" to "com.asus.mobilemanager.autostart.AutoStartActivity",
            "com.letv.android.letvsafe" to "com.letv.android.letvsafe.AutobootManageActivity",
        )
        for ((pkg, cls) in candidates) {
            if (tryStart(ctx, Intent().setClassName(pkg, cls))) return true
        }
        return openAppDetails(ctx)
    }

    /** Xiaomi's per-app battery saver ("No restrictions"), the other half of "keep calls reliable". */
    fun openMiuiBatterySaver(ctx: Context): Boolean {
        val intent = Intent("miui.intent.action.POWER_HIDE_MODE_APP_LIST")
            .setClassName("com.miui.powerkeeper", "com.miui.powerkeeper.ui.HiddenAppsConfigActivity")
            .putExtra("package_name", ctx.packageName)
            .putExtra("package_label", ctx.applicationInfo.loadLabel(ctx.packageManager).toString())
        return tryStart(ctx, intent) || openAppDetails(ctx)
    }
}
