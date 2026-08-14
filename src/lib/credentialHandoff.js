// postMessage credential hand-off.
//
// A caller page opens this app in a popup (or iframe) and passes AWS
// credentials directly via postMessage, keeping them out of URLs, browser
// history, and — unless the caller opts in — localStorage.
//
// Protocol:
//   1. Caller opens the app with window.open() (or embeds it in an iframe)
//   2. On boot the app announces { type: 'ready' } to its opener/parent
//   3. Caller replies with:
//        {
//          type: 'setKey',
//          saveKey: boolean,          // optional — defaults to false
//          payload: {
//            accessKeyID, secretAccessKey, bucketName, region
//          }
//        }
//
// Unless saveKey is explicitly true the credentials are held in memory only:
// nothing is written to localStorage and they die when the tab is closed.
// Previously saved credentials in localStorage are left untouched.
//
// Messages are accepted from ANY origin — credentials flow into the app, not
// out of it, so nothing can leak this way. The sender's origin is recorded in
// the credentialsOrigin store and shown to the user in Settings, and the
// credential fields there are hidden for the rest of the session so message-
// supplied keys can never be viewed or manually re-saved.

import { setCredentials, credentialsOrigin } from '../stores.js';
import { log } from './debug.js';

export function initCredentialHandoff() {
  window.addEventListener('message', (e) => {
    if (e.data?.type !== 'setKey') return;

    const p = e.data.payload || {};
    const creds = {
      // Caller protocol spells it "accessKeyID"; accept the SDK spelling too
      accessKeyId:     p.accessKeyID || p.accessKeyId || '',
      secretAccessKey: p.secretAccessKey || '',
      bucketName:      p.bucketName || '',
      region:          p.region || '',
    };
    if (!creds.accessKeyId || !creds.secretAccessKey || !creds.bucketName || !creds.region) {
      log('setKey ignored — payload incomplete', Object.keys(p));
      return;
    }

    setCredentials(creds, e.data.saveKey === true);
    credentialsOrigin.set(e.origin);
    log(`credentials received from ${e.origin} (saveKey=${e.data.saveKey === true})`);
  });

  // Announce readiness so the caller knows it can send setKey. The message
  // carries no data, so broadcasting with '*' is safe.
  const target = window.opener || (window.parent !== window ? window.parent : null);
  if (target) {
    try {
      target.postMessage({ type: 'ready' }, '*');
    } catch {
      // opener/parent already gone — nothing to announce to
    }
  }
}
