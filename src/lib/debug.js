// Debug logging utility.
//
// All diagnostic output in the app should go through log() rather than calling
// console.log directly. This keeps the browser console silent for end-users
// while still allowing developers to enable verbose output on demand.
//
// To activate debug mode, append ?debug=true to the URL, e.g.:
//   http://localhost:5173/?debug=true
//
// isDebug is also exported so other modules can branch on it (e.g. to show the
// XML preview screen in UploadProgress before any upload starts).

const isDebug = new URLSearchParams(window.location.search).get('debug') === 'true';

export function log(...args) {
  if (isDebug) {
    // Prefix all messages with [TEP] so they're easy to filter in the console
    console.log('[TEP]', ...args);
  }
}

export { isDebug };
