// Tints every UIRefreshControl the app does not tint itself with the brand ink
// (theme.ts brandInk, light and dark). React Native's RefreshControl passes its
// own tintColor, so in practice this reaches the web tabs' WKWebView
// pull-to-refresh, which has no tint prop.
const { withAppDelegate } = require("expo/config-plugins");

const MARK = "// with-refresh-tint";
const LINE = `    ${MARK}
    UIRefreshControl.appearance().tintColor = UIColor { $0.userInterfaceStyle == .dark
      ? UIColor(red: 30 / 255, green: 216 / 255, blue: 148 / 255, alpha: 1)
      : UIColor(red: 4 / 255, green: 122 / 255, blue: 84 / 255, alpha: 1) }
`;

module.exports = function withRefreshTint(config) {
  return withAppDelegate(config, (c) => {
    const src = c.modResults.contents;
    if (src.includes(MARK)) return c;
    const anchor = /didFinishLaunchingWithOptions[^{]*\{\n/;
    if (!anchor.test(src)) throw new Error("with-refresh-tint: AppDelegate launch method not found");
    c.modResults.contents = src.replace(anchor, (m) => m + LINE);
    return c;
  });
};
