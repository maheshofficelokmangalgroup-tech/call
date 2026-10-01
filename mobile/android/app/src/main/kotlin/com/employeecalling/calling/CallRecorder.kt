package com.employeecalling.calling

import android.content.Context
import android.media.MediaRecorder
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.util.Log
import java.io.File

/**
 * Records the microphone while a CRM call is connected (only when the organisation enabled recording).
 *
 * Honest limits, because Android does not give normal apps the other person's voice: the recording always holds the
 * employee's side and also the customer when the speaker is on and the phone lets apps use the microphone during a call.
 * A recording that turns out to be silent is thrown away instead of being uploaded as if it were a real call recording.
 */
object CallRecorder {
    private const val TAG = "CallRecorder"
    private const val SILENT_PEAK = 120 // MediaRecorder amplitude is 0..32767; speech is in the thousands, silence near 0
    private const val MIN_DURATION_MS = 1_500L

    class Result(val path: String, val durationMs: Long, val peak: Int, val silent: Boolean)

    private val main = Handler(Looper.getMainLooper())
    private var recorder: MediaRecorder? = null
    private var file: File? = null
    private var startedAt = 0L
    private var peak = 0
    private val sampler = object : Runnable {
        override fun run() {
            val active = recorder ?: return
            try {
                peak = maxOf(peak, active.maxAmplitude)
            } catch (e: Exception) {
                // the recorder is stopping
            }
            main.postDelayed(this, 400)
        }
    }

    val isRecording: Boolean get() = recorder != null

    private fun newRecorder(ctx: Context): MediaRecorder =
        if (Build.VERSION.SDK_INT >= 31) MediaRecorder(ctx) else @Suppress("DEPRECATION") MediaRecorder()

    /** Sources worth trying, best first. VOICE_CALL needs a system permission on Android 10+, so it is only tried before that. */
    private fun sources(): List<Int> {
        val list = mutableListOf<Int>()
        if (Build.VERSION.SDK_INT < 29) list.add(MediaRecorder.AudioSource.VOICE_CALL)
        list.add(MediaRecorder.AudioSource.VOICE_COMMUNICATION)
        list.add(MediaRecorder.AudioSource.VOICE_RECOGNITION)
        list.add(MediaRecorder.AudioSource.MIC)
        return list
    }

    @Synchronized
    fun start(ctx: Context, sessionId: String): Boolean {
        if (recorder != null) return true
        val dir = File(ctx.applicationContext.filesDir, "recordings").apply { mkdirs() }
        val target = File(dir, "$sessionId.m4a")
        for (source in sources()) {
            var candidate: MediaRecorder? = null
            try {
                candidate = newRecorder(ctx.applicationContext).apply {
                    setAudioSource(source)
                    setOutputFormat(MediaRecorder.OutputFormat.MPEG_4)
                    setAudioEncoder(MediaRecorder.AudioEncoder.AAC)
                    setAudioChannels(1)
                    setAudioSamplingRate(16_000)
                    setAudioEncodingBitRate(48_000)
                    setOutputFile(target.absolutePath)
                    prepare()
                    start()
                }
                recorder = candidate
                file = target
                startedAt = System.currentTimeMillis()
                peak = 0
                main.postDelayed(sampler, 400)
                Log.i(TAG, "recording with audio source $source")
                return true
            } catch (e: Exception) {
                Log.w(TAG, "audio source $source unusable: ${e.javaClass.simpleName} ${e.message}")
                try {
                    candidate?.release()
                } catch (_: Exception) {
                }
                target.delete()
            }
        }
        return false
    }

    @Synchronized
    fun stop(): Result? {
        val active = recorder ?: return null
        val out = file
        recorder = null
        file = null
        main.removeCallbacks(sampler)
        val duration = System.currentTimeMillis() - startedAt
        try {
            peak = maxOf(peak, active.maxAmplitude)
        } catch (_: Exception) {
        }
        var stopped = true
        try {
            active.stop()
        } catch (e: Exception) {
            stopped = false // "stop failed": no valid audio was captured (call ended almost immediately)
            Log.w(TAG, "stop failed", e)
        } finally {
            try {
                active.release()
            } catch (_: Exception) {
            }
        }
        if (out == null) return null
        if (!stopped || duration < MIN_DURATION_MS || !out.exists() || out.length() < 1024) {
            out.delete()
            return null
        }
        return Result(out.absolutePath, duration, peak, peak < SILENT_PEAK)
    }
}
