import ExpoModulesCore
import UIKit

// The color under every screen: the windows, their root views and the tab and
// navigation containers between them and the pages. iOS shows it wherever a
// page draws as a card, as at the rounded corners of a page sliding in or out
// or a tab cross-fading on iOS 26. expo-system-ui paints only the app
// delegate's window, and under the scene lifecycle that window is nil, so the
// window kept the light canvas from Info.plist in dark mode too, and the
// containers keep their own light default. This paints each scene's windows
// and containers, in a color that follows the system appearance by itself.
public class WindowCanvasModule: Module {
  public func definition() -> ModuleDefinition {
    Name("WindowCanvas")

    Function("setCanvas") { (light: UIColor, dark: UIColor) in
      DispatchQueue.main.async {
        let canvas = UIColor { $0.userInterfaceStyle == .dark ? dark : light }
        for scene in UIApplication.shared.connectedScenes {
          guard let windows = (scene as? UIWindowScene)?.windows else { continue }
          // Only the app's own windows. UIKit adds its own above them once a
          // keyboard has shown (UITextEffectsWindow); painted, it covered the
          // whole app in the canvas color.
          for window in windows where isAppWindow(window) {
            window.backgroundColor = canvas
            window.rootViewController?.view.backgroundColor = canvas
            window.rootViewController.map { paintContainers($0, canvas) }
          }
        }
      }
    }
  }
}

/** Not one of UIKit's private windows (all named UI..., unlike UIWindow itself). */
private func isAppWindow(_ window: UIWindow) -> Bool {
  let name = NSStringFromClass(type(of: window))
  return name == "UIWindow" || !(name.hasPrefix("UI") || name.hasPrefix("_UI"))
}

/** Every tab or navigation container under `controller`, presented ones included. Pages paint themselves. */
private func paintContainers(_ controller: UIViewController, _ canvas: UIColor) {
  if controller is UITabBarController || controller is UINavigationController {
    controller.view.backgroundColor = canvas
  }
  controller.children.forEach { paintContainers($0, canvas) }
  if let presented = controller.presentedViewController, presented.presentingViewController === controller {
    paintContainers(presented, canvas)
  }
}
