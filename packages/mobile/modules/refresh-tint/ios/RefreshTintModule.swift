import ExpoModulesCore
import UIKit

// The tint of every system pull to refresh the app does not tint itself: in
// practice a web screen's WKWebView, which has no tint prop. Set from the
// active design system, so a switch follows (on the next web screen opened).
public class RefreshTintModule: Module {
  public func definition() -> ModuleDefinition {
    Name("RefreshTint")

    Function("setTint") { (light: UIColor, dark: UIColor) in
      DispatchQueue.main.async {
        UIRefreshControl.appearance().tintColor = UIColor { $0.userInterfaceStyle == .dark ? dark : light }
      }
    }
  }
}
