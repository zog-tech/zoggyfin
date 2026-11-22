// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/.

import ExpoModulesCore
import UIKit

/// Crossfades the old layout into the new one when the screen turns.
///
/// The layout of a React Native screen comes from JavaScript, and JavaScript
/// hears of a rotation only after the system turn animation. Without help the
/// old layout shows at the new size for a moment and then jumps. A native app
/// lays out inside the animation, so the old screen fades into the new one.
///
/// When the view's bounds change between portrait and landscape and the
/// children are still laid out for the old orientation (`layoutWidth`,
/// `layoutHeight` from JS), the view puts a picture of the old pixels on top.
/// The picture turns with the screen. When JS sends a layout size with the new
/// orientation, the new layout is mounted in that same transaction; the
/// picture then fades out. After `maxHold` it fades out in any case.
class TurnCrossfadeView: ExpoView {
  private var laidOut = CGSize.zero
  private var shownBounds = CGSize.zero
  private var cover: UIView?
  private var coverTimer: Timer?
  private var fading = false

  static let fadeDuration: TimeInterval = 0.25
  static let maxHold: TimeInterval = 1.5

  required init(appContext: AppContext? = nil) {
    super.init(appContext: appContext)
    backgroundColor = .clear
  }

  func setLayoutSize(width: Double, height: Double) {
    laidOut = CGSize(width: width, height: height)
    if cover != nil, Self.sameOrientation(laidOut, bounds.size) {
      // The new layout mounts in this transaction: fade once it is on the screen.
      DispatchQueue.main.async { [weak self] in self?.fadeCover() }
    }
  }

  override func layoutSubviews() {
    super.layoutSubviews()
    let size = bounds.size
    defer { shownBounds = size }
    guard window != nil, size.width > 0, size.height > 0, shownBounds.width > 0, shownBounds.height > 0 else { return }
    if let cover {
      // A second size change during the turn: keep the picture centred.
      cover.center = CGPoint(x: bounds.midX, y: bounds.midY)
      bringSubviewToFront(cover)
      // Turned back before JS caught up: the children fit again.
      if Self.sameOrientation(laidOut, size) { DispatchQueue.main.async { [weak self] in self?.fadeCover() } }
      return
    }
    guard !Self.sameOrientation(shownBounds, size) else { return }
    // The children are already laid out for the new orientation: nothing to hide.
    guard laidOut.width > 0, laidOut.height > 0, !Self.sameOrientation(laidOut, size) else { return }
    // `afterScreenUpdates: false` copies the pixels that are on the screen now: the old layout.
    guard let picture = snapshotView(afterScreenUpdates: false) else { return }
    picture.frame = CGRect(origin: .zero, size: shownBounds)
    picture.center = CGPoint(x: bounds.midX, y: bounds.midY)
    picture.isUserInteractionEnabled = false
    addSubview(picture)
    cover = picture
    fading = false
    coverTimer?.invalidate()
    coverTimer = Timer.scheduledTimer(withTimeInterval: Self.maxHold, repeats: false) { [weak self] _ in
      self?.fadeCover()
    }
  }

  override func didMoveToWindow() {
    super.didMoveToWindow()
    if window == nil { removeCover() }
  }

  private func fadeCover() {
    guard let picture = cover, !fading else { return }
    fading = true
    coverTimer?.invalidate()
    coverTimer = nil
    UIView.animate(withDuration: Self.fadeDuration, delay: 0, options: [.curveEaseOut, .beginFromCurrentState]) {
      picture.alpha = 0
    } completion: { [weak self] _ in
      picture.removeFromSuperview()
      if self?.cover === picture {
        self?.cover = nil
        self?.fading = false
      }
    }
  }

  private func removeCover() {
    coverTimer?.invalidate()
    coverTimer = nil
    cover?.removeFromSuperview()
    cover = nil
    fading = false
  }

  /// Both sizes are landscape, or both are portrait.
  static func sameOrientation(_ a: CGSize, _ b: CGSize) -> Bool {
    (a.width > a.height) == (b.width > b.height)
  }
}

public class ZoggyfinTurnModule: Module {
  public func definition() -> ModuleDefinition {
    Name("ZoggyfinTurn")

    View(TurnCrossfadeView.self) {
      Prop("layoutSize") { (view: TurnCrossfadeView, size: [Double]) in
        guard size.count == 2 else { return }
        view.setLayoutSize(width: size[0], height: size[1])
      }
    }
  }
}
