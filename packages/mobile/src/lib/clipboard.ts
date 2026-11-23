// React Native's own pasteboard module (RCTClipboard), still in core though
// no longer exported from "react-native". It saves adding a native package
// (and a native rebuild) for one Copy action.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const Clipboard: { setString: (s: string) => void } = require("react-native/Libraries/Components/Clipboard/Clipboard").default;

export function copyText(text: string) {
  Clipboard.setString(text);
}
