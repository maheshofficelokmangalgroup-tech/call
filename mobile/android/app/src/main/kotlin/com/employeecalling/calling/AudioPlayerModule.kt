package com.employeecalling.calling

import android.media.AudioAttributes
import android.media.MediaPlayer
import android.os.Handler
import android.os.Looper
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.module.annotations.ReactModule

/** Streams a recording from its short-lived signed URL. One player at a time. */
@ReactModule(name = AudioPlayerModule.NAME)
class AudioPlayerModule(reactContext: ReactApplicationContext) : ReactContextBaseJavaModule(reactContext) {

    companion object {
        const val NAME = "AudioPlayerModule"
    }

    private val main = Handler(Looper.getMainLooper())
    private var player: MediaPlayer? = null
    private var ticker: Runnable? = null

    override fun getName() = NAME

    override fun invalidate() {
        main.post { release() }
        super.invalidate()
    }

    private fun emit(state: String, message: String? = null) {
        val params = Arguments.createMap()
        params.putString("state", state)
        params.putDouble("positionMs", (player?.let { safe { it.currentPosition } } ?: 0).toDouble())
        params.putDouble("durationMs", (player?.let { safe { it.duration } } ?: 0).toDouble())
        if (message != null) params.putString("message", message)
        PhoneEvents.emit("AudioPlayerState", params)
    }

    private inline fun <T> safe(block: () -> T): T? = try {
        block()
    } catch (e: IllegalStateException) {
        null
    }

    private fun startTicker() {
        stopTicker()
        val task = object : Runnable {
            override fun run() {
                val p = player ?: return
                if (safe { p.isPlaying } == true) emit("playing")
                main.postDelayed(this, 250)
            }
        }
        ticker = task
        main.post(task)
    }

    private fun stopTicker() {
        ticker?.let { main.removeCallbacks(it) }
        ticker = null
    }

    private fun release() {
        stopTicker()
        player?.let {
            safe { it.reset() }
            safe { it.release() }
        }
        player = null
    }

    @ReactMethod
    fun play(url: String) {
        main.post {
            release()
            try {
                val mp = MediaPlayer()
                player = mp
                mp.setAudioAttributes(
                    AudioAttributes.Builder().setContentType(AudioAttributes.CONTENT_TYPE_SPEECH).setUsage(AudioAttributes.USAGE_MEDIA).build(),
                )
                mp.setDataSource(url)
                mp.setOnPreparedListener {
                    it.start()
                    emit("playing")
                    startTicker()
                }
                mp.setOnCompletionListener {
                    stopTicker()
                    emit("completed")
                }
                mp.setOnErrorListener { _, what, extra ->
                    stopTicker()
                    emit("error", "Playback failed ($what/$extra)")
                    true
                }
                emit("preparing")
                mp.prepareAsync()
            } catch (e: Exception) {
                emit("error", e.message ?: "Playback failed")
            }
        }
    }

    @ReactMethod
    fun pause() {
        main.post {
            player?.let { if (safe { it.isPlaying } == true) safe { it.pause() } }
            stopTicker()
            emit("paused")
        }
    }

    @ReactMethod
    fun resume() {
        main.post {
            player?.let {
                safe { it.start() }
                emit("playing")
                startTicker()
            }
        }
    }

    @ReactMethod
    fun seekTo(positionMs: Double) {
        main.post {
            player?.let {
                safe { it.seekTo(positionMs.toInt()) }
                emit(if (safe { it.isPlaying } == true) "playing" else "paused")
            }
        }
    }

    @ReactMethod
    fun stop() {
        main.post {
            release()
            emit("stopped")
        }
    }

    @ReactMethod
    fun addListener(eventName: String) {
    }

    @ReactMethod
    fun removeListeners(count: Int) {
    }
}
