package com.golive.mobile

import android.Manifest
import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Person
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.content.pm.ServiceInfo
import android.graphics.drawable.Icon
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.os.Handler
import android.os.IBinder
import android.os.Looper
import android.os.Process
import android.os.ResultReceiver as OsResultReceiver
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.WritableMap
import java.util.UUID

internal data class VoiceSessionConfig(
  val sessionId: String,
  val roomLabel: String,
  val playbackActive: Boolean,
  val microphoneActive: Boolean,
  val micMuted: Boolean,
  val deafened: Boolean,
  val projectionActive: Boolean,
)

/**
 * User-visible service that keeps real WebRTC voice output/microphone work foregrounded.
 * It owns notification transport only; RoomSession and JS remain authoritative for media state.
 */
class VoiceSessionService : Service() {
  @Volatile private var config: VoiceSessionConfig? = null
  @Volatile private var activeStartToken: String? = null
  // Latched only after Android accepted a microphone-typed foreground start.
  // This represents FGS eligibility, not whether a microphone track is live.
  @Volatile private var microphoneFgsEstablished = false
  @Volatile private var lastStartId = 0
  private val currentNotificationId = NOTIFICATION_ID

  override fun onBind(intent: Intent?): IBinder? = null

  override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
    lastStartId = startId
    when (intent?.action) {
      ACTION_START -> handleStart(intent, startId)
      ACTION_UPDATE -> handleUpdate(intent, startId)
      ACTION_NOTIFICATION_ACTION -> handleNotificationAction(intent, startId)
      ACTION_STOP -> handleStop(intent, startId)
      else -> stopIfIdle(startId)
    }
    return START_NOT_STICKY
  }

  override fun onDestroy() {
    if (runningService === this) {
      runningService = null
      activeStartToken = null
    }
    if (config != null) {
      stopForeground(STOP_FOREGROUND_REMOVE)
      VoiceSessionModule.notifyStatus(statusMap(false, "service_stopped", config?.sessionId))
    }
    config?.sessionId?.let(::clearUnmuteClaims)
    config = null
    microphoneFgsEstablished = false
    super.onDestroy()
  }

  private fun handleStart(intent: Intent, startId: Int) {
    val startToken = intent.getStringExtra(EXTRA_START_TOKEN)
    if (startToken == null || consumeCancelledStart(startToken)) {
      sendResult(intent, RESULT_FAILED, "start_cancelled", config)
      stopIfIdle(startId)
      return
    }
    val requested = intent.readConfig() ?: run {
      sendResult(intent, RESULT_FAILED, "invalid_call_options", null)
      stopIfIdle(startId)
      return
    }
    val active = config
    if (active != null && active.sessionId != requested.sessionId) {
      sendResult(intent, RESULT_FAILED, "another_session_is_active", active)
      return
    }
    if (!hasRequiredRuntimePermissions(requested)) {
      sendResult(intent, RESULT_FAILED, "runtime_permission_missing", requested)
      stopIfIdle(startId)
      return
    }
    if (requiresVisibleMicrophonePromotion(requested)) {
      sendResult(intent, RESULT_FAILED, "activity_not_visible_for_microphone_fgs", active ?: requested)
      stopIfIdle(startId)
      return
    }

    try {
      createNotificationChannel()
      synchronized(START_LOCK) {
        if (cancelledStartTokens.contains(startToken)) {
          sendResult(intent, RESULT_FAILED, "start_cancelled", active)
          stopIfIdle(startId)
          return
        }
        startForegroundFor(requested)
        config = requested
        activeStartToken = startToken
        runningService = this
      }
      VoiceSessionActionQueue.clearOtherSessions(this, requested.sessionId)
      clearUnmuteClaimsExcept(requested.sessionId)
      sendResult(intent, RESULT_STARTED, null, requested)
      VoiceSessionModule.notifyStatus(statusMap(true, null, requested.sessionId))
    } catch (error: RuntimeException) {
      val reason = classifyForegroundFailure(error)
      // A failed update must not tear down a previously active same-session call.
      if (active == null) {
        try {
          stopForeground(STOP_FOREGROUND_REMOVE)
        } catch (_: RuntimeException) {
          // The service may not have been promoted before Android rejected startForeground.
        }
        config = null
        activeStartToken = null
        microphoneFgsEstablished = false
        if (runningService === this) runningService = null
        stopIfIdle(startId)
      }
      sendResult(intent, RESULT_FAILED, reason, config ?: requested)
      VoiceSessionModule.notifyStatus(statusMap(config != null, reason, config?.sessionId ?: requested.sessionId))
    }
  }

  private fun handleUpdate(intent: Intent, startId: Int) {
    val requested = intent.readConfig()
    val active = config
    if (requested == null || active == null || requested.sessionId != active.sessionId) {
      sendResult(intent, RESULT_FAILED, "service_not_running_for_session", requested)
      stopIfIdle(startId)
      return
    }
    if (!hasRequiredRuntimePermissions(requested)) {
      sendResult(intent, RESULT_FAILED, "runtime_permission_missing", requested)
      return
    }
    if (requiresVisibleMicrophonePromotion(requested)) {
      sendResult(intent, RESULT_FAILED, "activity_not_visible_for_microphone_fgs", active)
      return
    }

    try {
      startForegroundFor(requested)
      config = requested
      sendResult(intent, RESULT_STARTED, null, requested)
      VoiceSessionModule.notifyStatus(statusMap(true, null, requested.sessionId))
    } catch (error: RuntimeException) {
      val reason = classifyForegroundFailure(error)
      sendResult(intent, RESULT_FAILED, reason, active)
      VoiceSessionModule.notifyStatus(statusMap(true, reason, active.sessionId))
    }
  }

  private fun handleNotificationAction(intent: Intent, startId: Int) {
    val active = config
    val sessionId = intent.getStringExtra(EXTRA_SESSION_ID)
    val action = intent.getStringExtra(EXTRA_ACTION)
    if (active == null || sessionId != active.sessionId || action !in ACTIONS) {
      // A stale PendingIntent must never start a new call service or resurrect an old call.
      stopIfIdle(startId)
      return
    }
    val value = if (intent.hasExtra(EXTRA_VALUE)) intent.getBooleanExtra(EXTRA_VALUE, false) else null
    val queued = enqueueNotificationAction(active.sessionId, action!!, value)
    if (action == "disconnect") {
      // If JS is paused or gone, the watchdog kills this app process (and its WebRTC tracks).
      // Keep the durable action unacknowledged unless JS confirms it applied the disconnect.
      armDisconnectWatchdog(active.sessionId, queued?.optString("id"))
    }
    if (queued != null) {
      VoiceSessionModule.notifyAction(queued)
    } else {
      VoiceSessionModule.notifyStatus(statusMap(true, "action_queue_write_failed", active.sessionId))
    }
  }

  /** Publishes the durable action and its volatile authorization as one tap transaction. */
  private fun enqueueNotificationAction(
    sessionId: String,
    action: String,
    value: Boolean?,
  ): org.json.JSONObject? = synchronized(unmuteClaimLock) {
    val queued = VoiceSessionActionQueue.enqueue(this, sessionId, action, value)
    if (action == "setMicMuted" || action == "disconnect") {
      clearUnmuteClaims(sessionId)
    }
    val isUnmuteTap = queued?.let {
      it.optString("action") == "setMicMuted"
        && it.has("value")
        && !it.optBoolean("value", true)
    } == true
    if (isUnmuteTap && microphoneFgsEstablished) {
      grantNotificationUnmute(sessionId, queued!!.optString("id"))
    }
    queued
  }

  private fun handleStop(intent: Intent, startId: Int) {
    val sessionId = intent.getStringExtra(EXTRA_SESSION_ID)
    if (sessionId != null && config?.sessionId == sessionId) {
      stopActiveSession(sessionId, startId)
    } else {
      stopIfIdle(startId)
    }
  }

  private fun stopActiveSession(sessionId: String, startId: Int? = null) {
    if (config?.sessionId != sessionId) return
    cancelDisconnectWatchdog(sessionId)
    stopForeground(STOP_FOREGROUND_REMOVE)
    clearUnmuteClaims(sessionId)
    config = null
    activeStartToken = null
    microphoneFgsEstablished = false
    if (runningService === this) runningService = null
    stopSelfResult(startId ?: lastStartId)
    VoiceSessionModule.notifyStatus(statusMap(false, null, sessionId))
  }

  private fun stopIfIdle(startId: Int) {
    // Never let an invalid, stale, or mismatched command stop a different active session.
    if (config == null) stopSelfResult(startId)
  }

  private fun startForegroundFor(next: VoiceSessionConfig) {
    val notification = buildNotification(next)
    val typeMask = foregroundTypes(next)
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE && typeMask == 0) {
      throw IllegalStateException("No active foreground-service type for voice session")
    }
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q && typeMask != 0) {
      startForeground(currentNotificationId, notification, typeMask)
    } else {
      startForeground(currentNotificationId, notification)
    }
    if (next.microphoneActive) microphoneFgsEstablished = true
  }

  private fun foregroundTypes(state: VoiceSessionConfig): Int {
    var types = 0
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q && state.playbackActive) {
      types = types or ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PLAYBACK
    }
    // Keep a previously established microphone type across mute. Promotion from the background
    // is still forbidden below; microphoneActive continues to describe the actual live track.
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R
      && (state.microphoneActive || microphoneFgsEstablished)
    ) {
      types = types or ServiceInfo.FOREGROUND_SERVICE_TYPE_MICROPHONE
    }
    return types
  }

  private fun requiresVisibleMicrophonePromotion(next: VoiceSessionConfig): Boolean =
    Build.VERSION.SDK_INT >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE
    && next.microphoneActive
    && !microphoneFgsEstablished
    && !VoiceSessionVisibility.isActivityResumed()

  private fun hasRequiredRuntimePermissions(state: VoiceSessionConfig): Boolean =
    !state.microphoneActive || checkSelfPermission(Manifest.permission.RECORD_AUDIO) ==
      PackageManager.PERMISSION_GRANTED

  private fun createNotificationChannel() {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return
    val manager = getSystemService(NotificationManager::class.java)
    if (manager.getNotificationChannel(CHANNEL_ID) != null) return
    manager.createNotificationChannel(
      NotificationChannel(CHANNEL_ID, "Ongoing voice rooms", NotificationManager.IMPORTANCE_LOW).apply {
        description = "Controls for an active GoLive voice room"
        setShowBadge(false)
        lockscreenVisibility = Notification.VISIBILITY_PRIVATE
        setSound(null, null)
        enableVibration(false)
      },
    )
  }

  private fun buildNotification(state: VoiceSessionConfig): Notification {
    val builder = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
      Notification.Builder(this, CHANNEL_ID)
    } else {
      @Suppress("DEPRECATION")
      Notification.Builder(this)
    }
    val disconnectIntent = actionPendingIntent(state, "disconnect", null)
    val muteIntent = actionPendingIntent(state, "setMicMuted", !state.micMuted)
    val deafenIntent = actionPendingIntent(state, "setDeafened", !state.deafened)
    val contentIntent = PendingIntent.getActivity(
      this,
      CONTENT_REQUEST_CODE,
      Intent(this, MainActivity::class.java).apply {
        flags = Intent.FLAG_ACTIVITY_SINGLE_TOP or Intent.FLAG_ACTIVITY_CLEAR_TOP
      },
      PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
    )

    builder
      .setSmallIcon(R.drawable.ic_voice_call)
      .setContentTitle("GoLive voice room")
      .setContentText(state.roomLabel)
      .setContentIntent(contentIntent)
      .setCategory(Notification.CATEGORY_CALL)
      .setVisibility(Notification.VISIBILITY_PRIVATE)
      .setOngoing(true)
      .setOnlyAlertOnce(true)
      .setShowWhen(false)
      .setColor(0xFFC9FF42.toInt())
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
      builder.setForegroundServiceBehavior(Notification.FOREGROUND_SERVICE_IMMEDIATE)
      val person = Person.Builder().setName(state.roomLabel).setImportant(true).build()
      builder.setStyle(Notification.CallStyle.forOngoingCall(person, disconnectIntent))
        .addAction(Notification.Action.Builder(
          Icon.createWithResource(this, R.drawable.ic_voice_call),
          if (state.micMuted) "Unmute" else "Mute",
          muteIntent,
        ).build())
        .addAction(Notification.Action.Builder(
          Icon.createWithResource(this, R.drawable.ic_voice_call),
          if (state.deafened) "Undeafen" else "Deafen",
          deafenIntent,
        ).build())
    } else {
      @Suppress("DEPRECATION")
      builder.setPriority(Notification.PRIORITY_LOW)
      builder.addAction(R.drawable.ic_voice_call, "Disconnect", disconnectIntent)
        .addAction(R.drawable.ic_voice_call, if (state.micMuted) "Unmute" else "Mute", muteIntent)
        .addAction(R.drawable.ic_voice_call, if (state.deafened) "Undeafen" else "Deafen", deafenIntent)
    }
    return builder.build()
  }

  private fun actionPendingIntent(
    state: VoiceSessionConfig,
    action: String,
    value: Boolean?,
  ): PendingIntent {
    val uri = Uri.parse("golive-voice://${Uri.encode(state.sessionId)}/$action/${value ?: "none"}")
    val intent = Intent(this, VoiceSessionService::class.java).apply {
      this.action = ACTION_NOTIFICATION_ACTION
      data = uri
      putExtra(EXTRA_SESSION_ID, state.sessionId)
      putExtra(EXTRA_ACTION, action)
      if (value != null) putExtra(EXTRA_VALUE, value)
    }
    val requestCode = (uri.toString().hashCode() and 0x7fffffff)
    return PendingIntent.getService(
      this,
      requestCode,
      intent,
      PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
    )
  }

  private fun sendResult(intent: Intent, resultCode: Int, reason: String?, state: VoiceSessionConfig?) {
    finishStart(intent.getStringExtra(EXTRA_START_TOKEN))
    val receiver = intent.getReceiverExtra(EXTRA_RESULT_RECEIVER) ?: return
    val data = Bundle().apply {
      putString(RESULT_SESSION_ID, state?.sessionId)
      if (reason != null) putString(RESULT_REASON, reason)
      putInt(RESULT_ACTIVE_TYPES, if (state == null) 0 else foregroundTypes(state))
      putBoolean(RESULT_MICROPHONE_FGS_ACTIVE, microphoneFgsEstablished)
    }
    receiver.send(resultCode, data)
  }

  private fun statusMap(running: Boolean, reason: String?, sessionId: String?): WritableMap =
    Arguments.createMap().apply {
      putBoolean("running", running)
      putString("sessionId", sessionId)
      if (reason != null) putString("reason", reason)
      config?.let {
        putBoolean("playbackActive", it.playbackActive)
        putBoolean("microphoneActive", it.microphoneActive)
        putBoolean("micMuted", it.micMuted)
        putBoolean("deafened", it.deafened)
        putInt("activeTypes", foregroundTypes(it))
      }
      putBoolean("microphoneFgsActive", microphoneFgsEstablished)
      putBoolean("notificationPermissionGranted", notificationsAllowed(this@VoiceSessionService))
    }

  private fun classifyForegroundFailure(error: RuntimeException): String = when (error.javaClass.simpleName) {
    "ForegroundServiceStartNotAllowedException" -> "foreground_start_not_allowed"
    "SecurityException" -> "foreground_permission_or_while_in_use_denied"
    "MissingForegroundServiceTypeException" -> "foreground_service_type_missing"
    else -> "foreground_start_failed"
  }

  private fun armDisconnectWatchdog(sessionId: String, actionId: String?) {
    synchronized(DISCONNECT_LOCK) {
      val current = pendingDisconnect
      if (current?.sessionId == sessionId && current.actionId == actionId) return
      current?.let { disconnectHandler.removeCallbacks(it.runnable) }
      val ticket = UUID.randomUUID().toString()
      val runnable = Runnable {
        val shouldTerminate = synchronized(DISCONNECT_LOCK) {
          if (pendingDisconnect?.ticket != ticket) {
            false
          } else {
            pendingDisconnect = null
            true
          }
        }
        if (!shouldTerminate) return@Runnable

        val activeSessionId = runningService?.config?.sessionId
        val differentSessionPending = synchronized(START_LOCK) {
          pendingStarts.values.any { it != sessionId && it !in cancelledSessionIds }
        }
        // Do not let an old disconnect action terminate a newer, already-admitted room.
        if (activeSessionId != null && activeSessionId != sessionId) return@Runnable
        if (differentSessionPending) return@Runnable

        // This service and WebRTC's media-projection service share the app process. Stopping only
        // this service would leave native WebRTC tracks capturing while the JS bridge is paused.
        Process.killProcess(Process.myPid())
      }
      pendingDisconnect = PendingDisconnect(sessionId, actionId, ticket, runnable)
      disconnectHandler.postDelayed(runnable, DISCONNECT_WATCHDOG_MS)
    }
  }

  private fun cancelDisconnectWatchdog(sessionId: String, actionId: String? = null) {
    synchronized(DISCONNECT_LOCK) {
      val current = pendingDisconnect ?: return
      if (current.sessionId != sessionId || (actionId != null && current.actionId != actionId)) return
      disconnectHandler.removeCallbacks(current.runnable)
      pendingDisconnect = null
    }
  }

  private fun Intent.readConfig(): VoiceSessionConfig? {
    val sessionId = getStringExtra(EXTRA_SESSION_ID)?.takeIf { it.isNotBlank() && it.length <= 128 }
      ?: return null
    val roomLabel = getStringExtra(EXTRA_ROOM_LABEL)?.trim()?.take(96)?.takeIf { it.isNotBlank() }
      ?: return null
    if (!hasExtra(EXTRA_PLAYBACK_ACTIVE) || !hasExtra(EXTRA_MICROPHONE_ACTIVE)
      || !hasExtra(EXTRA_MIC_MUTED) || !hasExtra(EXTRA_DEAFENED)
      || !hasExtra(EXTRA_PROJECTION_ACTIVE)
    ) return null
    val playbackActive = getBooleanExtra(EXTRA_PLAYBACK_ACTIVE, false)
    val microphoneActive = getBooleanExtra(EXTRA_MICROPHONE_ACTIVE, false)
    if (!playbackActive && !microphoneActive) return null
    return VoiceSessionConfig(
      sessionId,
      roomLabel,
      playbackActive,
      microphoneActive,
      getBooleanExtra(EXTRA_MIC_MUTED, true),
      getBooleanExtra(EXTRA_DEAFENED, false),
      getBooleanExtra(EXTRA_PROJECTION_ACTIVE, false),
    )
  }

  private fun Intent.getReceiverExtra(key: String): OsResultReceiver? = try {
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
      getParcelableExtra(key, OsResultReceiver::class.java)
    } else {
      @Suppress("DEPRECATION")
      getParcelableExtra(key)
    }
  } catch (_: RuntimeException) {
    null
  }

  companion object {
    private const val CHANNEL_ID = "golive_voice_room"
    private const val NOTIFICATION_ID = 9702
    private const val CONTENT_REQUEST_CODE = 9703
    private const val ACTION_START = "com.golive.mobile.voice.START"
    private const val ACTION_UPDATE = "com.golive.mobile.voice.UPDATE"
    private const val ACTION_STOP = "com.golive.mobile.voice.STOP"
    private const val ACTION_NOTIFICATION_ACTION = "com.golive.mobile.voice.NOTIFICATION_ACTION"
    private const val EXTRA_SESSION_ID = "sessionId"
    private const val EXTRA_ROOM_LABEL = "roomLabel"
    private const val EXTRA_PLAYBACK_ACTIVE = "playbackActive"
    private const val EXTRA_MICROPHONE_ACTIVE = "microphoneActive"
    private const val EXTRA_MIC_MUTED = "micMuted"
    private const val EXTRA_DEAFENED = "deafened"
    private const val EXTRA_PROJECTION_ACTIVE = "projectionActive"
    private const val EXTRA_ACTION = "action"
    private const val EXTRA_VALUE = "value"
    private const val EXTRA_START_TOKEN = "startToken"
    private const val EXTRA_RESULT_RECEIVER = "resultReceiver"
    internal const val RESULT_REASON = "reason"
    const val RESULT_SESSION_ID = "sessionId"
    const val RESULT_ACTIVE_TYPES = "activeTypes"
    const val RESULT_MICROPHONE_FGS_ACTIVE = "microphoneFgsActive"
    const val RESULT_STARTED = 1
    const val RESULT_FAILED = 0
    private const val DISCONNECT_WATCHDOG_MS = 2_000L
    private val ACTIONS = setOf("disconnect", "setMicMuted", "setDeafened")
    @Volatile private var runningService: VoiceSessionService? = null
    private val START_LOCK = Any()
    private val pendingStarts = mutableMapOf<String, String>()
    private val cancelledStartTokens = mutableSetOf<String>()
    private val cancelledSessionIds = mutableSetOf<String>()
    private val DISCONNECT_LOCK = Any()
    private val disconnectHandler = Handler(Looper.getMainLooper())
    private data class PendingDisconnect(
      val sessionId: String,
      val actionId: String?,
      val ticket: String,
      val runnable: Runnable,
    )
    private var pendingDisconnect: PendingDisconnect? = null
    private data class UnmuteClaimKey(val sessionId: String, val actionId: String)
    private val unmuteClaimLock = Any()
    private val unmuteClaims = mutableSetOf<UnmuteClaimKey>()

    /** This process-local claim is created only by an eligible notification tap. */
    internal fun grantNotificationUnmute(sessionId: String, actionId: String) {
      synchronized(unmuteClaimLock) {
        unmuteClaims.removeAll { it.sessionId == sessionId }
        unmuteClaims.add(UnmuteClaimKey(sessionId, actionId))
      }
    }

    /** One successful consume permits exactly one JS microphone attempt. */
    internal fun consumeNotificationUnmuteClaim(sessionId: String, actionId: String): Boolean =
      synchronized(unmuteClaimLock) {
        unmuteClaims.remove(UnmuteClaimKey(sessionId, actionId))
      }

    internal fun revokeNotificationUnmuteClaim(sessionId: String, actionId: String) {
      synchronized(unmuteClaimLock) {
        unmuteClaims.remove(UnmuteClaimKey(sessionId, actionId))
      }
    }

    internal fun clearUnmuteClaims(sessionId: String) {
      synchronized(unmuteClaimLock) {
        unmuteClaims.removeAll { it.sessionId == sessionId }
      }
    }

    internal fun clearAllUnmuteClaims() {
      synchronized(unmuteClaimLock) { unmuteClaims.clear() }
    }

    private fun clearUnmuteClaimsExcept(sessionId: String) {
      synchronized(unmuteClaimLock) {
        unmuteClaims.removeAll { it.sessionId != sessionId }
      }
    }

    internal fun startFromModule(context: Context, config: VoiceSessionConfig, receiver: OsResultReceiver): String {
      val startToken = UUID.randomUUID().toString()
      synchronized(START_LOCK) {
        pendingStarts[startToken] = config.sessionId
        cancelledSessionIds.remove(config.sessionId)
      }
      val intent = Intent(context, VoiceSessionService::class.java).apply {
        action = ACTION_START
        putConfig(config)
        putExtra(EXTRA_START_TOKEN, startToken)
        putExtra(EXTRA_RESULT_RECEIVER, receiver)
      }
      try {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) context.startForegroundService(intent)
        else context.startService(intent)
      } catch (error: RuntimeException) {
        synchronized(START_LOCK) {
          pendingStarts.remove(startToken)
          cancelledStartTokens.remove(startToken)
        }
        throw error
      }
      return startToken
    }

    internal fun updateFromModule(
      context: Context,
      config: VoiceSessionConfig,
      callback: (Boolean, String?, Int?, Boolean) -> Unit,
    ) {
      Handler(Looper.getMainLooper()).post {
        val service = runningService
        if (service == null || service.config?.sessionId != config.sessionId) {
          callback(false, "service_not_running_for_session", null, false)
        } else {
          service.updateConfig(config, callback)
        }
      }
    }

    internal fun stopFromModule(
      context: Context,
      sessionId: String,
      expectedStartToken: String? = null,
    ): Boolean {
      synchronized(START_LOCK) {
        val service = runningService
        val activeMatches = service != null && service.config?.sessionId == sessionId
          && (expectedStartToken == null || service.activeStartToken == expectedStartToken)
        if (activeMatches) {
          service?.let {
            it.cancelDisconnectWatchdog(sessionId)
            Handler(Looper.getMainLooper()).post { it.stopActiveSession(sessionId) }
          }
          return true
        }

        val tokensToCancel = pendingStarts
          .filter { (token, pendingSession) ->
            pendingSession == sessionId && (expectedStartToken == null || token == expectedStartToken)
          }
          .keys
        if (tokensToCancel.isEmpty()) return false
        cancelledSessionIds.add(sessionId)
        cancelledStartTokens.addAll(tokensToCancel)
        return true
      }
    }

    internal fun acknowledgeDisconnect(sessionId: String, actionId: String) {
      synchronized(DISCONNECT_LOCK) {
        val current = pendingDisconnect ?: return
        if (current.sessionId == sessionId && current.actionId == actionId) {
          disconnectHandler.removeCallbacks(current.runnable)
          pendingDisconnect = null
        }
      }
    }

    internal fun status(context: Context, sessionId: String): WritableMap {
      val service = runningService
      val isRunning = service != null && service.config?.sessionId == sessionId
      return Arguments.createMap().apply {
        putBoolean("running", isRunning)
        putString("sessionId", if (isRunning) sessionId else null)
        putBoolean("microphoneFgsActive", isRunning && service?.microphoneFgsEstablished == true)
        if (isRunning) {
          service?.config?.let {
            putBoolean("playbackActive", it.playbackActive)
            putBoolean("microphoneActive", it.microphoneActive)
            putBoolean("micMuted", it.micMuted)
            putBoolean("deafened", it.deafened)
            putInt("activeTypes", service.foregroundTypes(it))
          }
        }
        putBoolean("notificationPermissionGranted", notificationsAllowed(context))
      }
    }

    internal fun activeStatus(context: Context): WritableMap {
      val service = runningService
      val activeConfig = service?.config
      return Arguments.createMap().apply {
        putBoolean("running", activeConfig != null)
        putString("sessionId", activeConfig?.sessionId)
        putBoolean("microphoneFgsActive", service?.microphoneFgsEstablished == true)
        putBoolean("notificationPermissionGranted", notificationsAllowed(context))
        activeConfig?.let {
          putString("roomLabel", it.roomLabel)
          putBoolean("playbackActive", it.playbackActive)
          putBoolean("microphoneActive", it.microphoneActive)
          putBoolean("micMuted", it.micMuted)
          putBoolean("deafened", it.deafened)
          putBoolean("projectionActive", it.projectionActive)
          putInt("activeTypes", service?.foregroundTypes(it) ?: 0)
        }
      }
    }

    internal fun notificationsAllowed(context: Context): Boolean {
      val manager = context.getSystemService(NotificationManager::class.java)
      if (!manager.areNotificationsEnabled()) return false
      return if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
        manager.getNotificationChannel(CHANNEL_ID)?.importance != NotificationManager.IMPORTANCE_NONE
      } else {
        true
      }
    }

    private fun Intent.putConfig(config: VoiceSessionConfig): Intent = apply {
      putExtra(EXTRA_SESSION_ID, config.sessionId)
      putExtra(EXTRA_ROOM_LABEL, config.roomLabel)
      putExtra(EXTRA_PLAYBACK_ACTIVE, config.playbackActive)
      putExtra(EXTRA_MICROPHONE_ACTIVE, config.microphoneActive)
      putExtra(EXTRA_MIC_MUTED, config.micMuted)
      putExtra(EXTRA_DEAFENED, config.deafened)
      putExtra(EXTRA_PROJECTION_ACTIVE, config.projectionActive)
    }

    private fun consumeCancelledStart(token: String): Boolean = synchronized(START_LOCK) {
      val cancelled = cancelledStartTokens.remove(token)
      if (cancelled) {
        val sessionId = pendingStarts.remove(token)
        if (sessionId != null && pendingStarts.values.none { it == sessionId }) cancelledSessionIds.remove(sessionId)
      }
      cancelled
    }

    private fun finishStart(token: String?) {
      if (token == null) return
      synchronized(START_LOCK) {
        val sessionId = pendingStarts.remove(token)
        cancelledStartTokens.remove(token)
        if (sessionId != null && pendingStarts.values.none { it == sessionId }) cancelledSessionIds.remove(sessionId)
      }
    }
  }

  private fun updateConfig(next: VoiceSessionConfig, callback: (Boolean, String?, Int?, Boolean) -> Unit) {
    val active = config
    if (active == null || active.sessionId != next.sessionId) {
      callback(false, "service_not_running_for_session", null, microphoneFgsEstablished)
      return
    }
    if (!hasRequiredRuntimePermissions(next)) {
      callback(false, "record_audio_permission_missing", config?.let(::foregroundTypes), microphoneFgsEstablished)
      return
    }
    if (requiresVisibleMicrophonePromotion(next)) {
      callback(false, "activity_not_visible_for_microphone_fgs", foregroundTypes(active), microphoneFgsEstablished)
      return
    }
    try {
      startForegroundFor(next)
      config = next
      callback(true, null, foregroundTypes(next), microphoneFgsEstablished)
      VoiceSessionModule.notifyStatus(statusMap(true, null, next.sessionId))
    } catch (error: RuntimeException) {
      val reason = classifyForegroundFailure(error)
      callback(false, reason, config?.let(::foregroundTypes), microphoneFgsEstablished)
      VoiceSessionModule.notifyStatus(statusMap(true, reason, config?.sessionId))
    }
  }
}
