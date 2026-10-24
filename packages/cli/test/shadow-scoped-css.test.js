import assert from 'node:assert/strict';
import test from 'node:test';
import { normalizeShadowScopedCss } from '../src/runtime/app-platform.js';

const HOST = '[data-notis-app-root],:host{';
const ROOT = '[data-notis-app-root]{';

test('standalone html, :root and body selectors move onto the shadow app root', () => {
  assert.equal(normalizeShadowScopedCss('html{a:1}:root{b:2}body{c:3}'), `${HOST}a:1}${HOST}b:2}${ROOT}c:3}`);
  assert.equal(normalizeShadowScopedCss('html, :host {a:1}:root,:host{b:2}'), `${HOST}a:1}${HOST}b:2}`);
  assert.equal(normalizeShadowScopedCss('@layer base{html {a:1}}\n@media print{\n  body {c:3}\n}'),
    `@layer base{${HOST}a:1}}\n@media print{\n  ${ROOT}c:3}\n}`);
  assert.equal(normalizeShadowScopedCss('h1,html{a:1}'), `h1,${HOST}a:1}`);
});

test('class names that end in or contain html or body are left alone', () => {
  const css = '.sl-kind-html{a:1}.sl-page-body {b:2}.html{c:3}.body{d:4}.htmlish{e:5}.my_body{f:6}.x-html-y{g:7}';
  assert.equal(normalizeShadowScopedCss(css), css);
});

test('ids, custom properties and escaped utilities are left alone', () => {
  const css = '#html{a:1}#body{b:2}.x{--html{c:3}}.md\\:root{d:4}.dark\\:html{e:5}';
  assert.equal(normalizeShadowScopedCss(css), css);
});

test('attribute selectors never rewrite the words they contain', () => {
  const css = '[data-kind=html]{a:1}[data-kind="body"]{b:2}[lang|=html] {c:3}[data-x="html {"]{d:4}';
  assert.equal(normalizeShadowScopedCss(css), css);
});

test('compound selectors only rewrite the standalone part right before the block', () => {
  assert.equal(normalizeShadowScopedCss('html.dark body{a:1}'), `html.dark ${ROOT}a:1}`);
  assert.equal(normalizeShadowScopedCss('body.dark{a:1}html[data-theme]{b:2}'), 'body.dark{a:1}html[data-theme]{b:2}');
  assert.equal(normalizeShadowScopedCss('div:root{a:1}'), 'div:root{a:1}');
});

test('comments and strings keep their text and never trigger a rewrite', () => {
  const css = '/* html { body { :root { */.a{content:"html{"}.b::after{content:\'body {\'}';
  assert.equal(normalizeShadowScopedCss(css), css);
  assert.equal(normalizeShadowScopedCss('/* reset */body{a:1}'), `/* reset */${ROOT}a:1}`);
  assert.equal(normalizeShadowScopedCss('.a{}/* note */html {b:2}'), `.a{}/* note */${HOST}b:2}`);
});

test('an escaped utility bracket never hides the global rules after it', () => {
  const utility = '.w-\\[100px\\]{width:100px}.content-\\[\\"x\\"\\]{a:1}';
  assert.equal(normalizeShadowScopedCss(`${utility}\nhtml{a:1}\nbody{b:2}`), `${utility}\n${HOST}a:1}\n${ROOT}b:2}`);
  assert.equal(normalizeShadowScopedCss('.md\\:root{a:1}'), '.md\\:root{a:1}');
});
