import type { Scheme, Theme } from "@lasagna/design";
import { fontsUrl, themeCss, TITLE_PAD_TOP } from "@lasagna/design/build/webCss";

// The active design system, handed to the hosted web app in the web fallback
// so a web page looks like the native screens around it. The stylesheet
// itself (the theme's --ui-* variables, fonts, component skins, the legacy
// palette remap and hero tints) is the web app's own design stylesheet,
// shared through packages/design, so a page draws the same in a browser and
// in the app. This file only puts it on the page.

export { fontsUrl, themeCss, TITLE_PAD_TOP };

/** Sets (or clears) the page's in-content title. Runs before load and again on a title change. */
export function titleScript(title: string, root: boolean): string {
  const t = JSON.stringify(title);
  return `(function(){var h=document.documentElement;
  if(${t}){h.style.setProperty('--lf-title',${JSON.stringify(JSON.stringify(title))});h.setAttribute('data-lf-title','');}else{h.removeAttribute('data-lf-title');}
  h.classList.toggle('lf-root',${root});})();`;
}

// packages/web/src/components/uikit/mode.ts's key. The web app reads it at boot
// to choose light or dark, so it follows the app rather than its own default.
const MODE_KEY = "lf-ui-mode";

/**
 * Applies a theme and scheme to the page: before it loads (the elements go
 * into <html> and move to the end of <head> once it exists, so they come
 * after the web's stylesheet), and again on any later change without a reload.
 */
export function designScript(theme: Theme, scheme: Scheme): string {
  const args = JSON.stringify({ id: theme.meta.id, dark: scheme === "dark", css: themeCss(theme), fonts: fontsUrl(theme), assistant: theme.mascot?.name ?? null });
  return `(function(d){
  try{localStorage.setItem('${MODE_KEY}',d.dark?'dark':'light')}catch(e){}
  var h=document.documentElement;
  h.setAttribute('data-design',d.id);
  // The assistant's name in the web's copy ("Ask Lasagna"): the theme's mascot, else the web's own default.
  if(d.assistant)h.setAttribute('data-assistant',d.assistant);else h.removeAttribute('data-assistant');
  // Marks the page as running inside the iOS app, so the web hands chat requests to the native Chat tab.
  h.setAttribute('data-shell','native');
  h.classList.toggle('dark',d.dark);
  h.style.colorScheme=d.dark?'dark':'light';
  var s=document.getElementById('lf-design');
  if(!s){s=document.createElement('style');s.id='lf-design';}
  s.textContent=d.css;
  var l=document.getElementById('lf-design-fonts');
  if(!l){l=document.createElement('link');l.id='lf-design-fonts';l.rel='stylesheet';window.__lfFontsCss=new Promise(function(r){l.onload=r;l.onerror=r;});}
  if(l.getAttribute('href')!==d.fonts)l.setAttribute('href',d.fonts);
  function place(){var p=document.head||h;p.appendChild(l);p.appendChild(s);}
  place();
  if(!document.head||document.readyState==='loading')document.addEventListener('DOMContentLoaded',place,{once:true});
})(${args});`;
}
