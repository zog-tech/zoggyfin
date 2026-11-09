// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/.

package expo.modules.zoggyfinnative

import android.app.Activity
import android.app.UiModeManager
import android.content.Context
import android.content.pm.PackageManager
import android.content.res.Configuration
import android.os.Bundle
import android.view.KeyEvent
import android.view.Window
import expo.modules.core.interfaces.ReactActivityLifecycleListener

/**
 * TV: a held D-pad key repeats fast (the Google TV remote sends about 20
 * key-downs a second), so the focus flies past rows and tiles. This drops
 * the repeated key-downs that come sooner than [MIN_GAP_MS] after the last
 * one let through: a held key moves the focus about 10 times a second. The
 * first press always goes through at once. Phones and tablets are not
 * touched. The JavaScript remote events come from the root view under this
 * window, so the player's scrubbing sees the same throttled repeats.
 */
class DpadRepeatThrottle : ReactActivityLifecycleListener {
  override fun onCreate(activity: Activity, savedInstanceState: Bundle?) {
    if (!isTv(activity)) return
    val window = activity.window ?: return
    val base = window.callback ?: return
    if (base is ThrottledCallback) return
    window.callback = ThrottledCallback(base)
  }

  private fun isTv(activity: Activity): Boolean {
    val ui = activity.getSystemService(Context.UI_MODE_SERVICE) as? UiModeManager
    return ui?.currentModeType == Configuration.UI_MODE_TYPE_TELEVISION ||
      activity.packageManager.hasSystemFeature(PackageManager.FEATURE_LEANBACK)
  }

  companion object {
    const val MIN_GAP_MS = 100L
  }
}

private class ThrottledCallback(private val base: Window.Callback) : Window.Callback by base {
  private var lastAt = 0L

  override fun dispatchKeyEvent(event: KeyEvent): Boolean {
    if (event.action == KeyEvent.ACTION_DOWN && isDpad(event.keyCode)) {
      if (event.repeatCount == 0) {
        lastAt = event.eventTime
      } else if (event.eventTime - lastAt < DpadRepeatThrottle.MIN_GAP_MS) {
        // Swallowed: the key-up still arrives, so nothing stays pressed.
        return true
      } else {
        lastAt = event.eventTime
      }
    }
    return base.dispatchKeyEvent(event)
  }

  private fun isDpad(code: Int): Boolean =
    code == KeyEvent.KEYCODE_DPAD_UP ||
      code == KeyEvent.KEYCODE_DPAD_DOWN ||
      code == KeyEvent.KEYCODE_DPAD_LEFT ||
      code == KeyEvent.KEYCODE_DPAD_RIGHT
}
