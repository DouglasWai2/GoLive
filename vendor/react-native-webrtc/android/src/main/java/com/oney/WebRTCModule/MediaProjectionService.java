package com.oney.WebRTCModule;

import android.app.Notification;
import android.app.Service;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.content.pm.ServiceInfo;
import android.os.Build;
import android.os.IBinder;
import android.util.Log;

import java.util.Random;
import java.util.concurrent.CompletableFuture;

/**
 * This class implements an Android {@link Service}, a foreground one specifically, and it's
 * responsible for presenting an ongoing notification when a conference is in progress.
 * The service will help keep the app running while in the background.
 *
 * See: https://developer.android.com/guide/components/services
 */
public class MediaProjectionService extends Service {
    private static final String TAG = MediaProjectionService.class.getSimpleName();

    static final int NOTIFICATION_ID = new Random().nextInt(99999) + 10000;

    private static volatile CompletableFuture<Void> startFuture;
    private static volatile boolean microphoneActive;
    private static volatile MediaProjectionService runningService;

    public static void setMicrophoneActive(boolean active) {
        microphoneActive = active;

        MediaProjectionService service = runningService;
        if (service != null && Build.VERSION.SDK_INT >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE) {
            service.updateForegroundNotification();
        }
    }

    public static CompletableFuture<Void> launch(Context context) {
        if (!WebRTCModuleOptions.getInstance().enableMediaProjectionService) {
            return CompletableFuture.completedFuture(null);
        }

        CompletableFuture<Void> future = new CompletableFuture<>();

        startFuture = future;

        MediaProjectionNotification.createNotificationChannel(context);
        Intent intent = new Intent(context, MediaProjectionService.class);
        ComponentName componentName;

        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                componentName = context.startForegroundService(intent);
            } else {
                componentName = context.startService(intent);
            }
        } catch (RuntimeException e) {
            // Avoid crashing due to ForegroundServiceStartNotAllowedException (API level 31).
            // See: https://developer.android.com/guide/components/foreground-services#background-start-restrictions
            Log.w(TAG, "Media projection service not started", e);
            startFuture = null;
            future.completeExceptionally(e);

            return future;
        }

        if (componentName == null) {
            Log.w(TAG, "Media projection service not started");
            startFuture = null;
            future.completeExceptionally(new RuntimeException("Media projection service not started"));
        } else {
            Log.i(TAG, "Media projection service started");
        }

        return future;
    }

    public static void abort(Context context) {
        if (!WebRTCModuleOptions.getInstance().enableMediaProjectionService) {
            return;
        }

        Intent intent = new Intent(context, MediaProjectionService.class);
        context.stopService(intent);
    }

    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }

    @Override
    public void onCreate() {
        super.onCreate();
        runningService = this;
    }

    @Override
    public void onDestroy() {
        if (runningService == this) {
            runningService = null;
        }
        super.onDestroy();
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        updateForegroundNotification();

        CompletableFuture<Void> fut = startFuture;

        if (fut != null) {
            startFuture = null;
            fut.complete(null);
        }

        return START_NOT_STICKY;
    }

    private void updateForegroundNotification() {
        Notification notification = MediaProjectionNotification.buildMediaProjectionNotification(this);

        int serviceTypes = ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PROJECTION;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE && microphoneActive) {
            serviceTypes |= ServiceInfo.FOREGROUND_SERVICE_TYPE_MICROPHONE;
        }

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            startForeground(NOTIFICATION_ID, notification, serviceTypes);
        } else {
            startForeground(NOTIFICATION_ID, notification);
        }
    }
}
