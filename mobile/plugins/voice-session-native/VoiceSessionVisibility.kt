package com.golive.mobile

/** Tracks the visible Activity so call FGS startup can be rejected when initiated too late. */
internal object VoiceSessionVisibility {
  @Volatile
  private var activityResumed = false

  fun setActivityResumed(resumed: Boolean) {
    activityResumed = resumed
  }

  fun isActivityResumed(): Boolean = activityResumed
}
