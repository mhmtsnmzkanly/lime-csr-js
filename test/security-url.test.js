import assert from 'node:assert/strict';
import test from 'node:test';
import { JSDOM } from 'jsdom';

import {
  mount,
  subscribeDiagnostics,
} from '../src/index.js';

test('static interpolation sanitizes unsafe url schemes in url attributes', () => {
  const dom = new JSDOM(`<!doctype html>
    <html>
      <body>
        <template id="tpl-url-test">
          <a id="link-bad-js" href="\${evilJs}">bad link</a>
          <a id="link-bad-data" href="\${evilData}">bad link 2</a>
          <a id="link-good-http" href="\${goodHttp}">good link</a>
          <a id="link-good-rel" href="\${goodRel}">good rel</a>
          <img id="img-bad" src="\${evilJs}">
          <img id="img-good" src="\${goodImg}">
        </template>
        <main id="app"></main>
      </body>
    </html>
  `, { url: 'http://localhost/' });

  globalThis.document = dom.window.document;
  globalThis.Node = dom.window.Node;
  globalThis.NodeFilter = dom.window.NodeFilter;

  const diagnostics = [];
  const unsubDiag = subscribeDiagnostics((d) => diagnostics.push(d));

  try {
    const target = document.getElementById('app');
    mount({ target: target, template: 'url-test', store: null, ...{
      context: {
        evilJs: 'javascript:alert(1)',
        evilData: 'data:text/html,<script>alert(1)</script>',
        goodHttp: 'https://example.com/profile',
        goodRel: '/about#team',
        goodImg: 'https://example.com/avatar.png',
      },
    } });

    const badLinkJs = target.querySelector('#link-bad-js');
    const badLinkData = target.querySelector('#link-bad-data');
    const goodLinkHttp = target.querySelector('#link-good-http');
    const goodLinkRel = target.querySelector('#link-good-rel');
    const imgBad = target.querySelector('#img-bad');
    const imgGood = target.querySelector('#img-good');

    assert.equal(badLinkJs.getAttribute('href'), '');
    assert.equal(badLinkData.getAttribute('href'), '');
    assert.equal(goodLinkHttp.getAttribute('href'), 'https://example.com/profile');
    assert.equal(goodLinkRel.getAttribute('href'), '/about#team');
    assert.equal(imgBad.getAttribute('src'), '');
    assert.equal(imgGood.getAttribute('src'), 'https://example.com/avatar.png');

    // Diagnostics should report UNSAFE_URL_ATTR
    const urlWarnings = diagnostics.filter((d) => d.code === 'UNSAFE_URL_ATTR');
    assert.equal(urlWarnings.length, 3); // badLinkJs, badLinkData, imgBad
  } finally {
    unsubDiag();
  }
});
