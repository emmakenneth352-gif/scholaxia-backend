package com.scholaxia.scholaxia

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.os.Build
import android.os.IBinder

/**
 * Foreground service that keeps a [android.media.projection.MediaProjection]
 * session alive while the user shares their screen in a live class.
 *
 * Android 14+ requires an app to run a mediaProjection-type foreground service
 * for the whole duration of a screen capture, and it must be started AFTER the
 * user grants the system consent dialog (createScreenCaptureIntent) but BEFORE
 * MediaProjectionManager.getMediaProjection() is called.
 *
 * MainActivity.startScreenShareService() launches this service at the right
 * moment; it stops itself when screen sharing ends or the projection is revoked.
 */
class ScreenShareForegroundService : Service() {

    companion object {
        const val CHANNEL_ID = "screen_share_channel"
        const val NOTIFICATION_ID = 4711

        const val ACTION_STOP = "com.scholaxia.scholaxia.action.STOP_SCREEN_SHARE_FGS"

        /** True while the foreground service is running. */
        @Volatile
        var isRunning: Boolean = false
            private set
    }

    override fun onCreate() {
        super.onCreate()
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            createChannel()
        }
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        if (intent?.action == ACTION_STOP) {
            stopForegroundService()
            return START_NOT_STICKY
        }
        if (isRunning) return START_STICKY

        val notification = buildNotification()
        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE) {
                // Android 14+: explicitly declare the mediaProjection FGS type.
                startForeground(
                    NOTIFICATION_ID,
                    notification,
                    ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PROJECTION,
                )
            } else {
                startForeground(NOTIFICATION_ID, notification)
            }
            isRunning = true
        } catch (e: Exception) {
            // Consent was revoked between dialog and start, or another
            // start-foreground restriction applied: fail softly, the caller
            // will surface the resulting capture error in the UI.
            stopSelf()
        }
        return START_STICKY
    }

    override fun onDestroy() {
        isRunning = false
        super.onDestroy()
    }

    override fun onBind(intent: Intent?): IBinder? = null

    private fun buildNotification(): Notification {
        val stopIntent = Intent(this, ScreenShareForegroundService::class.java).apply {
            action = ACTION_STOP
        }
        val stopPending = PendingIntent.getService(
            this,
            0,
            stopIntent,
            PendingIntent.FLAG_ONE_SHOT or PendingIntent.FLAG_IMMUTABLE,
        )

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            return Notification.Builder(this, CHANNEL_ID)
                .setContentTitle("Scholaxia")
                .setContentText("Screen sharing is active")
                .setSmallIcon(android.R.drawable.ic_menu_view)
                .setOngoing(true)
                .setCategory(Notification.CATEGORY_SERVICE)
                .addAction(
                    Notification.Action.Builder(
                        null,
                        "Stop",
                        stopPending,
                    ).build(),
                )
                .build()
        }

        @Suppress("DEPRECATION")
        return Notification.Builder(this)
            .setContentTitle("Scholaxia")
            .setContentText("Screen sharing is active")
            .setSmallIcon(android.R.drawable.ic_menu_view)
            .setOngoing(true)
            .build()
    }

    private fun createChannel() {
        val nm = getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
        if (nm.getNotificationChannel(CHANNEL_ID) == null) {
            val channel = NotificationChannel(
                CHANNEL_ID,
                "Screen sharing",
                NotificationManager.IMPORTANCE_LOW,
            ).apply {
                description = "Shown while you share your screen in a live class"
                setShowBadge(false)
            }
            nm.createNotificationChannel(channel)
        }
    }

    private fun stopForegroundService() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.N) {
            stopForeground(STOP_FOREGROUND_REMOVE)
        } else {
            @Suppress("DEPRECATION")
            stopForeground(true)
        }
        stopSelf()
    }
}
