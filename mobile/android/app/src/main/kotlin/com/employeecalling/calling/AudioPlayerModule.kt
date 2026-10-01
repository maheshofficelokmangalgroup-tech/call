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

/**
 * Streams a recording from its short-lived signed URL. One player at a time.
 *
 * MediaPlayer is a state machine and must not be asked for its position or duration before it is prepared: the platform answers a
 * call in the wrong state by posting MEDIA_ERROR (-38) to the player itself, which puts it into the error state for good. So the
 * state is tracked here ([prepared]) and position / duration are only read from a prepared player.
 */
@ReactModule(name = AudioPlayerModule.NAME)
class AudioPlayerModule(reactContext: ReactApplicationContext) : ReactContextBaseJavaModule(reactContext) {

    companion object {
        const val NAME = "AudioPlayerModule"
    }

    private val main = Handler(Looper.getMainLooper())
    private var player: MediaPlayer? = null
    private var prepared = false
    private var ticker: Runnable? = null

    override fun getName() = NAME

    override fun invalidate() {
        main.post { release() }
        super.invalidate()
    }

    private fun emit(state: String, message: String? = null) {
        val current = player?.takeIf { prepared }
        val params = Arguments.createMap()
        params.putString("state", state)
        params.putDouble("positionMs", (current?.let { safe { it.currentPosition } } ?: 0).toDouble())
        params.putDouble("durationMs", (current?.let { safe { it.duration } } ?: 0).toDouble())
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
                if (prepared && safe { p.isPlaying } == true) emit("playing")
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
        prepared = false
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
                    if (player !== it) return@setOnPreparedListener // a newer play() replaced this player
                    prepared = true
                    it.start()
                    emit("playing")
                    startTicker()
                }
                mp.setOnCompletionListener {
                    if (player !== it) return@setOnCompletionListener
                    stopTicker()
                    emit("completed")
                }
                mp.setOnErrorListener { failed, what, extra ->
                    if (player === failed) {
                        // an errored player is unusable: report it and let go of it (never ask it for its position)
                        release()
                        emit("error", "Playback failed ($what/$extra)")
                    }
                    true
                }
                emit("preparing")
                mp.prepareAsync()
            } catch (e: Exception) {
                release()
                emit("error", e.message ?: "Playback failed")
            }
        }
    }

    @ReactMethod
    fun pause() {
        main.post {
            player?.let { if (prepared && safe { it.isPlaying } == true) safe { it.pause() } }
            stopTicker()
            emit("paused")
        }
    }

    @ReactMethod
    fun resume() {
        main.post {
            player?.let {
                if (!prepared) return@post
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
                if (!prepared) return@post
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
