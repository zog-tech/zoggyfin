// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/.

package expo.modules.zoggyfinnative

import android.content.Context
import android.graphics.Canvas
import android.graphics.Rect
import android.view.View
import android.view.ViewGroup
import expo.modules.kotlin.AppContext
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import expo.modules.kotlin.views.ExpoView

/**
 * TV: a container that hides its content (`src/native/tv-visibility.native.tsx`). The TV side menu keeps every tab
 * mounted in one. Hidden, the content is not drawn and takes no focus, but
 * its views stay where they are, attached to the window, with their images.
 * `display: none` made React Native drop every native view of a hidden tab
 * and build them all again on the next visit (seconds on a TV stick), and a
 * detached tab (react-native-screens) came back with images it never drew.
 */
class ZoggyfinTvVisibilityModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("ZoggyfinTvVisibility")

    View(TvVisibilityView::class) {
      Prop("hidden") { view: TvVisibilityView, hidden: Boolean ->
        view.setHidden(hidden)
      }
    }
  }
}

class TvVisibilityView(context: Context, appContext: AppContext) : ExpoView(context, appContext) {
  private var hidden = false

  fun setHidden(value: Boolean) {
    hidden = value
    descendantFocusability = if (value) ViewGroup.FOCUS_BLOCK_DESCENDANTS else ViewGroup.FOCUS_AFTER_DESCENDANTS
    if (value) findFocus()?.clearFocus()
    invalidate()
  }

  // The view's own visibility is left alone (React Native's mounting sets it back): hidden, it
  // draws no children and offers no focusable view, whatever the views under it say.
  override fun dispatchDraw(canvas: Canvas) {
    if (!hidden) super.dispatchDraw(canvas)
  }

  override fun addFocusables(views: ArrayList<View>, direction: Int, focusableMode: Int) {
    if (!hidden) super.addFocusables(views, direction, focusableMode)
  }

  override fun onRequestFocusInDescendants(direction: Int, previouslyFocusedRect: Rect?): Boolean =
    if (hidden) false else super.onRequestFocusInDescendants(direction, previouslyFocusedRect)
}
