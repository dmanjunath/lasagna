import UIKit
import Capacitor

class MainViewController: CAPBridgeViewController {
    /// Canvas colour, mirroring `--ui-canvas` in theme.css: #f7f9fc light,
    /// #0d1117 dark. Resolved per trait collection so it follows the system.
    private static let canvas = UIColor { traits in
        traits.userInterfaceStyle == .dark
            ? UIColor(red: 13 / 255, green: 17 / 255, blue: 23 / 255, alpha: 1)
            : UIColor(red: 247 / 255, green: 249 / 255, blue: 252 / 255, alpha: 1)
    }

    override func capacitorDidLoad() {
        // Capacitor paints the WebView from the single `backgroundColor` in
        // capacitor.config, which cannot vary by appearance. Override it so a
        // dark device never shows the light canvas underneath the page.
        //
        // This runs from loadView(), where CAPBridgeViewController assigns
        // `view = webView` — so the controller's view and the web view are the
        // same object, and setting it here covers both.
        webView?.backgroundColor = Self.canvas
        webView?.scrollView.backgroundColor = Self.canvas

        // Left edge is owned by the JS gesture layer (shell.tsx): drawer on main
        // pages, history-back on sub-pages. The WebView's own back-gesture would
        // otherwise walk history into the pre-login state, so keep it off.
        webView?.allowsBackForwardNavigationGestures = false
    }
}
