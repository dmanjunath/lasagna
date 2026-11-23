// Native screens change data the web pages also show (a recategorize moves a
// Spending total). Every change the server accepted bumps this counter, and a
// web screen that loaded before the bump reloads when it is next in view (M-1).

let version = 0;

/** A native change landed. */
export function markWebStale() {
  version++;
}

export function webDataVersion(): number {
  return version;
}
