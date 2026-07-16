import UIKit
import Capacitor

class MainViewController: CAPBridgeViewController {
    override func capacitorDidLoad() {
        // Left edge is owned by the JS gesture layer (shell.tsx): drawer on main
        // pages, history-back on sub-pages. The WebView's own back-gesture would
        // otherwise walk history into the pre-login state, so keep it off.
        webView?.allowsBackForwardNavigationGestures = false
    }
}
