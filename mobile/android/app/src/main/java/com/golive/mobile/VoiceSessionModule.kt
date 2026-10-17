package com.golive.mobile

import android.Manifest
import android.content.pm.PackageManager
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.os.ResultReceiver
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.bridge.ReadableMap
import com.facebook.react.bridge.WritableMap
import com.facebook.react.modules.core.DeviceEventManagerModule
import java.lang.ref.WeakReference
import java.util.concurrent.atomic.AtomicReference

/**
 * Native bridge for the ongoing Android voice-call foreground service.
 * JS owns session/audio state; this module exposes a bounded action outbox and service status.
 */
class VoiceSessionModule(
  reactContext: ReactApplicationContext,
) : ReactContextBaseJavaModule(reactContext) {
  private val mainHandler = Handler(Looper.getMainLooper())
  @Volatile private var listenerCount = 0

  init {
    currentModule = WeakReference(this)
  }

  override fun getName(): String = NAME

  @ReactMethod
  fun addListener(eventName: String) {
    listenerCount += 1
  }

  @ReactMethod
  fun removeListeners(count: Double) {
    listenerCount = (listenerCount - count.toInt()).coerceAtLeast(0)
  }

  @ReactMethod
  fun startCall(options: ReadableMap, promise: Promise) {
    val config = readConfig(options, promise) ?: return
    if (!VoiceSessionVisibility.isActivityResumed()) {
      promise.resolve(result(false, "activity_not_visible", config.sessionId))
      return
    }
    if (config.microphoneActive && !hasMicrophonePermission()) {
      promise.resolve(result(false, "record_audio_permission_missing", config.sessionId))
      return
    }

    val finished = java.util.concurrent.atomic.AtomicBoolean(false)
    val startToken = AtomicReference<String?>(null)
    val timeout = Runnable {
      if (finished.compareAndSet(false, true)) {
        VoiceSessionService.stopFromModule(reactApplicationContext, config.sessionId, startToken.get())
        promise.resolve(result(false, "foreground_start_timeout", config.sessionId))
      }
    }
    mainHandler.postDelayed(timeout, START_TIMEOUT_MS)
    val receiver = object : ResultReceiver(mainHandler) {
      override fun onReceiveResult(resultCode: Int, data: Bundle?) {
        if (!finished.compareAndSet(false, true)) return
        mainHandler.removeCallbacks(timeout)
        promise.resolve(resultFromBundle(resultCode, data, config.sessionId))
      }
    }

    try {
      startToken.set(VoiceSessionService.startFromModule(reactApplicationContext, config, receiver))
    } catch (error: RuntimeException) {
      if (finished.compareAndSet(false, true)) {
        mainHandler.removeCallbacks(timeout)
        promise.resolve(result(false, classifyStartError(error), config.sessionId))
      }
    }
  }

  @ReactMethod
  fun updateCallState(options: ReadableMap, promise: Promise) {
    val config = readConfig(options, promise) ?: return
    if (config.microphoneActive && !hasMicrophonePermission()) {
      promise.resolve(result(false, "record_audio_permission_missing", config.sessionId))
      return
    }
    VoiceSessionService.updateFromModule(reactApplicationContext, config) { started, reason, activeTypes, microphoneFgsActive ->
      promise.resolve(result(started, reason, config.sessionId, activeTypes, microphoneFgsActive))
    }
  }

  @ReactMethod
  fun stopCall(sessionId: String, promise: Promise) {
    val normalized = normalizeSessionId(sessionId)
    if (normalized == null) {
      promise.resolve(result(false, "invalid_session_id", sessionId))
      return
    }
    val stopped = VoiceSessionService.stopFromModule(reactApplicationContext, normalized)
    promise.resolve(result(stopped, if (stopped) null else "service_not_running", normalized))
  }

  @ReactMethod
  fun getStatus(sessionId: String, promise: Promise) {
    val normalized = normalizeSessionId(sessionId)
    if (normalized == null) {
      promise.resolve(result(false, "invalid_session_id", sessionId))
      return
    }
    promise.resolve(VoiceSessionService.status(reactApplicationContext, normalized))
  }

  /** Exposes the active service identity so a re-created JS bridge can reconcile safely. */
  @ReactMethod
  fun getActiveStatus(promise: Promise) {
    promise.resolve(VoiceSessionService.activeStatus(reactApplicationContext))
  }

  /** A fresh JS runtime must not inherit taps issued by its predecessor. */
  @ReactMethod
  fun resetUnmuteClaims(promise: Promise) {
    VoiceSessionService.clearAllUnmuteClaims()
    promise.resolve(true)
  }

  /** Returns matching actions without deleting them; ackAction removes only after JS applied one. */
  @ReactMethod
  fun consumePendingActions(sessionId: String, promise: Promise) {
    val normalized = normalizeSessionId(sessionId)
    if (normalized == null) {
      promise.resolve(Arguments.createArray())
      return
    }
    val result = Arguments.createArray()
    VoiceSessionActionQueue.pending(reactApplicationContext, normalized).forEach { action ->
      result.pushMap(Arguments.createMap().apply {
        putString("id", action.optString("id"))
        putDouble("sequence", action.optLong("sequence").toDouble())
        putString("sessionId", action.optString("sessionId"))
        putString("action", action.optString("action"))
        putDouble("createdAt", action.optLong("createdAt").toDouble())
        if (action.has("value")) putBoolean("value", action.optBoolean("value"))
      })
    }
    promise.resolve(result)
  }

  /** Consumes the process-local claim before JS begins getUserMedia for this exact queued Unmute. */
  @ReactMethod
  fun consumeUnmuteClaim(sessionId: String, actionId: String, promise: Promise) {
    val normalized = normalizeSessionId(sessionId)
    val pendingAction = if (normalized != null && actionId.isNotBlank()) {
      VoiceSessionActionQueue.find(reactApplicationContext, normalized, actionId)
    } else {
      null
    }
    val isPendingUnmute = pendingAction?.optString("action") == "setMicMuted"
      && pendingAction.has("value")
      && !pendingAction.optBoolean("value", true)
    val consumed = isPendingUnmute
      && VoiceSessionService.consumeNotificationUnmuteClaim(normalized!!, actionId)
    promise.resolve(consumed)
  }

  @ReactMethod
  fun ackAction(sessionId: String, actionId: String, promise: Promise) {
    val normalized = normalizeSessionId(sessionId)
    val pendingAction = if (normalized != null && actionId.isNotBlank()) {
      VoiceSessionActionQueue.find(reactApplicationContext, normalized, actionId)
    } else {
      null
    }
    val acknowledged = normalized != null
      && actionId.isNotBlank()
      && VoiceSessionActionQueue.acknowledge(reactApplicationContext, normalized, actionId)
    if (acknowledged && pendingAction?.optString("action") == "disconnect") {
      VoiceSessionService.acknowledgeDisconnect(normalized!!, actionId)
    }
    promise.resolve(acknowledged)
  }

  /** Removes only an explicitly failed Unmute; it cannot discard disconnect or other state changes. */
  @ReactMethod
  fun discardFailedUnmute(sessionId: String, actionId: String, promise: Promise) {
    val normalized = normalizeSessionId(sessionId)
    if (normalized != null && actionId.isNotBlank()) {
      // Revoke before disk I/O; failed persistence must not restore eligibility.
      VoiceSessionService.revokeNotificationUnmuteClaim(normalized, actionId)
    }
    val discarded = normalized != null && actionId.isNotBlank()
      && VoiceSessionActionQueue.discardFailedUnmute(reactApplicationContext, normalized, actionId)
    promise.resolve(discarded)
  }

  override fun invalidate() {
    if (currentModule?.get() === this) currentModule = null
    VoiceSessionService.clearAllUnmuteClaims()
    super.invalidate()
  }

  private fun readConfig(options: ReadableMap, promise: Promise): VoiceSessionConfig? {
    if (!options.hasKey("sessionId") || !options.hasKey("roomLabel")
      || !options.hasKey("playbackActive") || !options.hasKey("microphoneActive")
      || !options.hasKey("micMuted") || !options.hasKey("deafened")
      || !options.hasKey("projectionActive")
    ) {
      promise.resolve(result(false, "invalid_call_options", null))
      return null
    }
    val sessionId = normalizeSessionId(options.getString("sessionId"))
    val roomLabel = options.getString("roomLabel")?.trim()?.take(96).orEmpty()
    if (sessionId == null || roomLabel.isBlank()) {
      promise.resolve(result(false, "invalid_call_options", sessionId))
      return null
    }
    val playbackActive = options.getBoolean("playbackActive")
    val microphoneActive = options.getBoolean("microphoneActive")
    if (!playbackActive && !microphoneActive) {
      promise.resolve(result(false, "no_active_audio_type", sessionId))
      return null
    }
    return VoiceSessionConfig(
      sessionId = sessionId,
      roomLabel = roomLabel,
      playbackActive = playbackActive,
      microphoneActive = microphoneActive,
      micMuted = options.getBoolean("micMuted"),
      deafened = options.getBoolean("deafened"),
      projectionActive = options.getBoolean("projectionActive"),
    )
  }

  private fun hasMicrophonePermission(): Boolean =
    reactApplicationContext.checkSelfPermission(Manifest.permission.RECORD_AUDIO) ==
      PackageManager.PERMISSION_GRANTED

  private fun normalizeSessionId(value: String?): String? =
    value?.trim()?.takeIf { it.isNotEmpty() && it.length <= MAX_SESSION_ID_LENGTH }

  private fun result(
    started: Boolean,
    reason: String?,
    sessionId: String?,
    activeTypes: Int? = null,
    microphoneFgsActive: Boolean? = null,
  ): WritableMap = Arguments.createMap().apply {
    putBoolean("started", started)
    putString("sessionId", sessionId)
    if (reason != null) putString("reason", reason)
    if (activeTypes != null) putInt("activeTypes", activeTypes)
    if (microphoneFgsActive != null) putBoolean("microphoneFgsActive", microphoneFgsActive)
    putBoolean("notificationPermissionGranted", VoiceSessionService.notificationsAllowed(reactApplicationContext))
  }

  private fun resultFromBundle(resultCode: Int, data: Bundle?, sessionId: String): WritableMap =
    result(
      started = resultCode == VoiceSessionService.RESULT_STARTED,
      reason = data?.getString(VoiceSessionService.RESULT_REASON),
      sessionId = data?.getString(VoiceSessionService.RESULT_SESSION_ID) ?: sessionId,
      activeTypes = data?.getInt(VoiceSessionService.RESULT_ACTIVE_TYPES),
      microphoneFgsActive = data?.getBoolean(VoiceSessionService.RESULT_MICROPHONE_FGS_ACTIVE),
    )

  private fun classifyStartError(error: RuntimeException): String = when (error.javaClass.simpleName) {
    "ForegroundServiceStartNotAllowedException" -> "foreground_start_not_allowed"
    "SecurityException" -> "foreground_permission_or_while_in_use_denied"
    else -> "foreground_start_failed"
  }

  private fun emit(eventName: String, payload: WritableMap) {
    if (listenerCount <= 0 || !reactApplicationContext.hasActiveReactInstance()) return
    try {
      reactApplicationContext
        .getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter::class.java)
        .emit(eventName, payload)
    } catch (_: RuntimeException) {
      // The persistent outbox remains available through consumePendingActions after bridge startup.
    }
  }

  private fun emitAction(action: org.json.JSONObject) {
    val payload = Arguments.createMap().apply {
      putString("id", action.optString("id"))
      putDouble("sequence", action.optLong("sequence").toDouble())
      putString("sessionId", action.optString("sessionId"))
      putString("action", action.optString("action"))
      if (action.has("value")) putBoolean("value", action.optBoolean("value"))
    }
    emit("actionRequested", payload)
  }

  private fun emitStatus(payload: WritableMap) = emit("serviceStatus", payload)

  companion object {
    const val NAME = "GoLiveVoiceSession"
    private const val MAX_SESSION_ID_LENGTH = 128
    private const val START_TIMEOUT_MS = 8_000L
    @Volatile private var currentModule: WeakReference<VoiceSessionModule>? = null

    internal fun notifyAction(action: org.json.JSONObject) {
      currentModule?.get()?.emitAction(action)
    }

    internal fun notifyStatus(payload: WritableMap) {
      currentModule?.get()?.emitStatus(payload)
    }
  }
}
