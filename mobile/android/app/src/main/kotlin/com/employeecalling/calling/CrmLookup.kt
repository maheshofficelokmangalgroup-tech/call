package com.employeecalling.calling

import android.content.Context
import android.database.sqlite.SQLiteDatabase
import android.util.Log

/**
 * Finds the CRM name for a phone number straight from the app's local contact cache, so the incoming-call notification can
 * say "Rahul Shinde" instead of a number even before any JavaScript has run. Read-only; the cache is emptied at sign-out.
 */
object CrmLookup {
    private const val TAG = "CrmLookup"
    private const val DB_NAME = "employee-calling.db"

    fun nameFor(ctx: Context, number: String): String? {
        val digits = number.filter { it.isDigit() }
        if (digits.length < 6) return null
        val file = ctx.getDatabasePath(DB_NAME)
        if (!file.exists()) return null
        return try {
            SQLiteDatabase.openDatabase(file.path, null, SQLiteDatabase.OPEN_READONLY).use { db ->
                db.rawQuery(
                    "SELECT name FROM contacts WHERE replace(replace(phone, '+', ''), ' ', '') LIKE ? LIMIT 1",
                    arrayOf("%" + digits.takeLast(10)),
                ).use { cursor -> if (cursor.moveToFirst()) cursor.getString(0) else null }
            }
        } catch (e: Exception) {
            Log.i(TAG, "no CRM lookup: ${e.javaClass.simpleName}")
            null
        }
    }
}
