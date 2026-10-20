import './testDom';
import assert from 'node:assert/strict';
import test from 'node:test';
import { renderToStaticMarkup } from 'react-dom/server';

import { Icon, hasIcon, renderIcon } from './icons';

test('the built-in set has the refresh icons and plus (follow-ups B12, B13)', () => {
  for (const name of ['arrow-clockwise', 'arrows-clockwise', 'plus']) {
    assert.ok(hasIcon(name), name);
    const markup = renderToStaticMarkup(<Icon name={name} />);
    assert.match(markup, /^<svg class="nui-icon" viewBox="0 0 16 16" aria-hidden="true" focusable="false"><path /, name);
    assert.equal(renderToStaticMarkup(<>{renderIcon(name)}</>), markup, 'an icon prop takes the name');
  }
  assert.equal(hasIcon('arrow-clockwise-bold'), false);
  assert.equal(renderToStaticMarkup(<Icon name="arrow-clockwise-bold" />), '', 'an unknown name renders nothing');
});
