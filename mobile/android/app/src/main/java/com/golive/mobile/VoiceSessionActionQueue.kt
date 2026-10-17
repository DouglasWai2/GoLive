package com.golive.mobile

import android.content.Context
import org.json.JSONArray
import org.json.JSONObject
import java.util.UUID

/** A tiny durable outbox for notification commands; it never stores room credentials. */
internal object VoiceSessionActionQueue {
  private const val PREFS = "golive_voice_session_actions"
  private const val KEY_ACTIONS = "pending_actions"
  private const val KEY_SEQUENCE = "next_sequence"
  private const val MAX_ACTIONS = 12

  @Synchronized
  fun enqueue(
    context: Context,
    sessionId: String,
    action: String,
    value: Boolean?,
  ): JSONObject? {
    val actions = read(context)
    if (actions.any { it.optString("sessionId") == sessionId && it.optString("action") == "disconnect" }) {
      return actions.firstOrNull {
        it.optString("sessionId") == sessionId && it.optString("action") == "disconnect"
      }
    }

    val sameIntent = actions.firstOrNull {
      it.optString("sessionId") == sessionId
        && it.optString("action") == action
        && (!it.has("value") || value == it.optBoolean("value"))
    }
    // Each Unmute tap gets a fresh action ID so an old failed record cannot inherit
    // the next tap's process-local authorization.
    val isUnmuteTap = action == "setMicMuted" && value == false
    if (sameIntent != null && !isUnmuteTap) return sameIntent

    // State-setting commands coalesce by operation; a newer desired state replaces the older one.
    if (action != "disconnect") {
      actions.removeAll {
        it.optString("sessionId") == sessionId && it.optString("action") == action
      }
    } else {
      actions.removeAll { it.optString("sessionId") == sessionId }
    }

    val preferences = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
    val sequence = preferences.getLong(KEY_SEQUENCE, 0L) + 1L
    val item = JSONObject()
      .put("id", UUID.randomUUID().toString())
      .put("sequence", sequence)
      .put("sessionId", sessionId)
      .put("action", action)
      .put("createdAt", System.currentTimeMillis())
    if (value != null) item.put("value", value)

    while (actions.size >= MAX_ACTIONS) actions.removeAt(0)
    actions.add(item)
    return if (write(context, actions, sequence)) item else null
  }

  @Synchronized
  fun pending(context: Context, sessionId: String): List<JSONObject> =
    read(context).filter { it.optString("sessionId") == sessionId }

  @Synchronized
  fun find(context: Context, sessionId: String, actionId: String): JSONObject? =
    read(context).firstOrNull {
      it.optString("sessionId") == sessionId && it.optString("id") == actionId
    }

  @Synchronized
  fun acknowledge(context: Context, sessionId: String, actionId: String): Boolean {
    val actions = read(context)
    val removed = actions.removeAll {
      it.optString("sessionId") == sessionId && it.optString("id") == actionId
    }
    return removed && write(context, actions)
  }

  /** Drops only a failed notification Unmute; unlike ACK, this never claims it was applied. */
  @Synchronized
  fun discardFailedUnmute(context: Context, sessionId: String, actionId: String): Boolean {
    val actions = read(context)
    val target = actions.firstOrNull {
      it.optString("sessionId") == sessionId && it.optString("id") == actionId
    } ?: return false
    if (target.optString("action") != "setMicMuted"
      || !target.has("value")
      || target.optBoolean("value", true)
    ) return false
    val removed = actions.removeAll {
      it.optString("sessionId") == sessionId && it.optString("id") == actionId
    }
    return removed && write(context, actions)
  }

  @Synchronized
  fun clearOtherSessions(context: Context, activeSessionId: String) {
    val actions = read(context)
    // Retain disconnects until JS acknowledges them, even if another room starts later.
    if (actions.removeAll {
        it.optString("sessionId") != activeSessionId && it.optString("action") != "disconnect"
      }
    ) write(context, actions)
  }

  private fun read(context: Context): MutableList<JSONObject> {
    val raw = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).getString(KEY_ACTIONS, null)
      ?: return mutableListOf()
    return try {
      val array = JSONArray(raw)
      MutableList(array.length()) { index -> array.getJSONObject(index) }
    } catch (_: Exception) {
      mutableListOf()
    }
  }

  private fun write(context: Context, actions: List<JSONObject>, nextSequence: Long? = null): Boolean {
    val array = JSONArray()
    actions.forEach(array::put)
    // Commit before notifying JS so process death cannot lose a command already delivered.
    val editor = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
      .edit()
      .putString(KEY_ACTIONS, array.toString())
    if (nextSequence != null) editor.putLong(KEY_SEQUENCE, nextSequence)
    return editor.commit()
  }
}
