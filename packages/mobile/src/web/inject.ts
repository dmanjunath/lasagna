// The web fallback runs the hosted web app inside a WKWebView. It signs in
// through the same session cookie the web uses, and hides the web app's own
// chrome so the native navigation bar is the only one on screen.

export function cookieFor(apiUrl: string, token: string) {
  return {
    url: apiUrl,
    cookie: { name: "lasagna_session", value: token, path: "/", httpOnly: true, secure: apiUrl.startsWith("https:") },
  };
}

// Selectors match packages/web/src/components/layout (app-header, mobile-tab-bar,
// mobile-nav, shell). If those change, the fallback shows doubled chrome.
const HIDE_CSS = [
  "header.fixed.top-0{display:none!important}",
  "nav.fixed.bottom-0{display:none!important}",
  "div.fixed.inset-0.bg-black{display:none!important}",
  "[role=dialog].fixed.left-0{display:none!important}",
  "main{padding-top:0!important}",
  // The web shell sets --mobile-header-h inline (49pt + strip) on its root so
  // content and sticky bars clear its own header. That header is hidden here,
  // so zero it everywhere: !important in a sheet beats the inline value.
  "*{--mobile-header-h:0px!important}",
].join("");

// packages/web/src/lib/hide-amounts.ts reads this key once, at boot.
const HIDE_AMOUNTS_KEY = "lf-hide-amounts";

// packages/web/src/lib/auth.tsx's hint: with it, the web app's first render is
// the signed-in shell rather than its sign-in screen while /me is in flight.
const AUTH_HINT_KEY = "lf_auth_hint";

/** Seeds the web app's last-known user and tenant from the native session. */
export function authHintScript(hint: { user: unknown; tenant: unknown } | null): string {
  if (!hint) return "";
  return `try{localStorage.setItem('${AUTH_HINT_KEY}',${JSON.stringify(JSON.stringify(hint))})}catch(e){}`;
}

/**
 * Posts {type:'ready'} once the page has drawn its content (the shell's main
 * holds something) and its fonts have loaded (the theme's web font sheet, then
 * the faces it uses, at most 2s more), so native can keep its own skeleton up until then.
 */
const READY_SCRIPT = `(function(){var done=false,obs;function send(){window.ReactNativeWebView.postMessage(JSON.stringify({type:'ready'}));}
function post(){if(!document.fonts)return send();var css=window.__lfFontsCss||Promise.resolve();Promise.race([css.then(function(){return new Promise(function(r){requestAnimationFrame(r);});}).then(function(){return document.fonts.ready;}),new Promise(function(r){setTimeout(r,2000);})]).then(send,send);}
function check(){if(done)return;var m=document.querySelector('main');if(m&&m.getBoundingClientRect().height>0&&m.querySelector('h1,h2,h3,p,a,button,section,img,svg')){done=true;if(obs)obs.disconnect();requestAnimationFrame(function(){requestAnimationFrame(post);});}}
function start(){obs=new MutationObserver(check);obs.observe(document.body,{childList:true,subtree:true});check();}
if(document.body)start();else document.addEventListener('DOMContentLoaded',start);})();`;

/**
 * Reports the page's vertical scroll as {type:'scroll', y}, once a frame, so
 * the native bar can fade its title in as the page's own title scrolls away.
 * Whichever element scrolls the page (the document, or the shell's main) counts.
 */
const SCROLL_SCRIPT = `var lastY=-1,queued=false;document.addEventListener('scroll',function(e){var t=e.target;var el=(t===document||t===document.documentElement||t===document.body)?document.scrollingElement:t;if(!el||el.clientHeight<innerHeight*0.5||queued)return;queued=true;requestAnimationFrame(function(){queued=false;var y=Math.round(el.scrollTop);if(y!==lastY){lastY=y;window.ReactNativeWebView.postMessage(JSON.stringify({type:'scroll',y:y}));}});},true);`;

/** Sets the web app's hide-amounts flag to the native one. Runs before the page boots, or before a reload. */
export function amountsScript(hidden: boolean): string {
  return `try{${hidden ? `localStorage.setItem('${HIDE_AMOUNTS_KEY}','1')` : `localStorage.removeItem('${HIDE_AMOUNTS_KEY}')`}}catch(e){}`;
}

/**
 * Runs before the page's own scripts. Reports every navigation to native as
 * `{type:'nav', path, kind}`, where kind is push, replace, pop or load.
 * `hideChrome: false` keeps the web app's own header (onboarding has no native bar).
 */
export function injectedScript({
  hideChrome = true,
  amountsHidden = false,
  authHint = null,
}: { hideChrome?: boolean; amountsHidden?: boolean; authHint?: { user: unknown; tenant: unknown } | null } = {}): string {
  // The web shell's own touch gestures (the edge swipe for its drawer or back,
  // and its pull-to-refresh, whose indicator lives in the hidden header) all
  // listen on the document. This listener is registered first, so a touch
  // stops there before theirs see it. Native owns those gestures here. Taps,
  // scrolling and the page's own element handlers are untouched.
  const chrome = hideChrome
    ? `var s=document.createElement('style');s.textContent=${JSON.stringify(HIDE_CSS)};(document.head||document.documentElement).appendChild(s);` +
      `document.addEventListener('touchstart',function(e){e.stopImmediatePropagation();},{passive:true});`
    : "";
  return `(function(){
  ${amountsScript(amountsHidden)}
  ${authHintScript(authHint)}
  ${chrome}
  ${READY_SCRIPT}
  function report(kind){window.ReactNativeWebView.postMessage(JSON.stringify({type:'nav',path:location.pathname+location.search,kind:kind}));}
  [['pushState','push'],['replaceState','replace']].forEach(function(p){var o=history[p[0]];history[p[0]]=function(){var r=o.apply(this,arguments);report(p[1]);return r;};});
  window.addEventListener('popstate',function(){report('pop');});
  report('load');
  ${SCROLL_SCRIPT}
})();true;`;
}
