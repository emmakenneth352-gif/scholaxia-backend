package com.scholaxia.scholaxia

import android.content.Intent
import android.os.Build
import io.flutter.embedding.android.FlutterActivity
import io.flutter.embedding.engine.FlutterEngine
import io.flutter.plugin.common.MethodChannel

class MainActivity : FlutterActivity() {

    private val channelName = "scholaxia/screen_share"

    override fun configureFlutterEngine(flutterEngine: FlutterEngine) {
        super.configureFlutterEngine(flutterEngine)

        MethodChannel(flutterEngine.dartExecutor.binaryMessenger, channelName)
            .setMethodCallHandler { call, result ->
                when (call.method) {
                    "startScreenShareService" -> {
                        val ok = startScreenShareService()
                        result.success(ok)
                    }
                    "stopScreenShareService" -> {
                        stopService(Intent(this, ScreenShareForegroundService::class.java))
                        result.success(true)
                    }
                    "isScreenShareServiceRunning" -> {
                        result.success(ScreenShareForegroundService.isRunning)
                    }
                    else -> result.notImplemented()
                }
            }
    }

    /**
     * Starts the mediaProjection foreground service.
     *
     * MUST be called after the user has granted the system screen-capture
     * consent dialog (flutter_webrtc's requestCapturePermission) and before
     * LiveKit publishes the screen track (getMediaProjection).
     */
    private fun startScreenShareService(): Boolean {
        if (ScreenShareForegroundService.isRunning) return true
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) {
            // FGS with types only enforced from Android 14; the legacy
            // startForegroundService API exists since API 26.
            return true
        }
        return try {
            val intent = Intent(this, ScreenShareForegroundService::class.java)
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                startForegroundService(intent)
            } else {
                startService(intent)
            }
            true
        } catch (e: Exception) {
            false
        }
    }
}
