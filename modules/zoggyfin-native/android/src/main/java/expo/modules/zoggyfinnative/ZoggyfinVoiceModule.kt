// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/.

package expo.modules.zoggyfinnative

import android.app.Activity
import android.content.ActivityNotFoundException
import android.content.Intent
import android.speech.RecognizerIntent
import expo.modules.kotlin.Promise
import expo.modules.kotlin.exception.CodedException
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

/**
 * Voice input for the search field (`src/native/voice-input.native.ts`).
 *
 * On Google TV the remote's voice button opens the system Assistant, which
 * searches the whole TV, not this app. `listen` opens the system speech
 * screen (ACTION_RECOGNIZE_SPEECH, the TV's voice input) and resolves with
 * what was said, or null when the user closed it. The app needs no
 * microphone permission: the system screen records. Google TV has two
 * handlers (its voice screen and the speech service) and showed a chooser,
 * so a known voice screen is asked for by package when the device has one.
 */
class ZoggyfinVoiceModule : Module() {
  private var pending: Promise? = null

  override fun definition() = ModuleDefinition {
    Name("ZoggyfinVoice")

    /** True when the device has a speech screen. */
    Function("available") {
      val activity = appContext.currentActivity ?: return@Function false
      speechIntent(null, activity).resolveActivity(activity.packageManager) != null
    }

    AsyncFunction("listen") { prompt: String?, promise: Promise ->
      val activity = appContext.currentActivity
      if (activity == null) {
        promise.reject(CodedException("ERR_VOICE", "No screen to show voice input on.", null))
        return@AsyncFunction
      }
      // A second call while the screen is open takes over: the first one gets null.
      pending?.resolve(null)
      pending = promise
      try {
        activity.startActivityForResult(speechIntent(prompt, activity), REQUEST)
      } catch (e: ActivityNotFoundException) {
        pending = null
        promise.reject(CodedException("ERR_VOICE", "This device has no voice input.", e))
      }
    }

    OnActivityResult { _, payload ->
      if (payload.requestCode != REQUEST) return@OnActivityResult
      val promise = pending ?: return@OnActivityResult
      pending = null
      val text =
        if (payload.resultCode == Activity.RESULT_OK) {
          payload.data?.getStringArrayListExtra(RecognizerIntent.EXTRA_RESULTS)?.firstOrNull()
        } else {
          null
        }
      promise.resolve(text)
    }
  }

  private fun speechIntent(prompt: String?, activity: Activity): Intent {
    val intent =
      Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH).apply {
        putExtra(RecognizerIntent.EXTRA_LANGUAGE_MODEL, RecognizerIntent.LANGUAGE_MODEL_FREE_FORM)
        putExtra(RecognizerIntent.EXTRA_MAX_RESULTS, 1)
        if (prompt != null) putExtra(RecognizerIntent.EXTRA_PROMPT, prompt)
      }
    val handlers = activity.packageManager.queryIntentActivities(intent, 0).map { it.activityInfo.packageName }.toSet()
    PREFERRED.firstOrNull { it in handlers }?.let { intent.setPackage(it) }
    return intent
  }

  private companion object {
    const val REQUEST = 0x5a0c

    /** Voice screens to use when present: Google TV, then the Google app on phones. */
    val PREFERRED = listOf("com.google.android.katniss", "com.google.android.googlequicksearchbox")
  }
}
