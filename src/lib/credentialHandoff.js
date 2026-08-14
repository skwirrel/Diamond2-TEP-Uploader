// postMessage credential hand-off.
//
// A caller page opens this app in a popup (or iframe) and passes AWS
// credentials directly via postMessage, keeping them out of URLs, browser
// history, and localStorage.
//
// Protocol:
//   1. Caller opens the app with window.open() (or embeds it in an iframe)
//   2. On boot the app announces { type: 'ready' } to its opener/parent
//   3. Caller replies with:
//        {
//          type: 'setKey',
//          payload: {
//            accessKeyID, secretAccessKey, bucketName, region
//          }
//        }
//
// Message-supplied credentials are NEVER persisted: they are held in memory
// only and die when the tab is closed. A broadcaster integrating this way
// will want users to always come through the launcher (and the keys may well
// be short-lived STS credentials anyway), so there is deliberately no opt-in
// to persistence. Any credentials the user previously saved themselves in
// localStorage are left untouched.
//
// Messages are accepted from ANY origin — credentials flow into the app, not
// out of it, so nothing can leak this way. The sender's origin is recorded in
// the credentialsOrigin store and shown to the user in Settings, and the
// credential fields there are hidden for the rest of the session so message-
// supplied keys can never be viewed or manually saved.

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

    setCredentials(creds, false);
    credentialsOrigin.set(e.origin);
    log(`credentials received from ${e.origin} (session only, never persisted)`);
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
