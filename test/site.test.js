import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildSite } from '../scripts/site-olustur.js';

test('GitHub Pages sitesi doğru üretilir', () => {
  const out = join(mkdtempSync(join(tmpdir(), 'seyahat-site-')), '_site');
  try {
    const { url } = buildSite(out, {});
    assert.match(url, /^https:\/\/[a-z0-9]+\.supabase\.co$/);
    for (const f of ['index.html', 'giris.html', 'kisi.html', '.nojekyll', 'static/css/app.css', 'static/js/app.js', 'static/js/arka-uc.js']) {
      assert.ok(existsSync(join(out, f)), f);
    }
    const adapter = readFileSync(join(out, 'static/js/arka-uc.js'), 'utf8');
    assert.doesNotMatch(adapter, /__SUPABASE_(URL|KEY)__/);
    assert.match(adapter, /rest\/v1\/rpc/);
    for (const f of ['index.html', 'giris.html', 'kisi.html']) {
      const html = readFileSync(join(out, f), 'utf8');
      assert.match(html, /<meta http-equiv="Content-Security-Policy" content="default-src 'self'; script-src 'self'; style-src 'self';/);
      assert.ok(html.includes(`connect-src ${url};`), 'connect-src yalnızca Supabase');
      assert.match(html, /<meta name="referrer" content="no-referrer">/);
      assert.doesNotMatch(html, /"\/static\//, 'yollar göreli olmalı (depo alt dizini)');
      assert.doesNotMatch(html, /<script(?![^>]*\bsrc=)[^>]*>|<style|\sstyle=|\son[a-z]+=/i);
    }
    assert.throws(() => buildSite(out, { SUPABASE_URL: 'http://kotu.example', SUPABASE_PUBLISHABLE_KEY: 'x' }), /https/);
  } finally {
    rmSync(join(out, '..'), { recursive: true, force: true });
  }
});

test('arayüz kullanıcı verisini innerHTML ile basmaz', () => {
  for (const f of ['app.js', 'giris.js', 'kisi.js', 'ortak.js', 'arka-uc.js']) {
    const src = readFileSync(new URL(`../public/js/${f}`, import.meta.url), 'utf8');
    assert.doesNotMatch(src, /innerHTML|outerHTML|insertAdjacentHTML|document\.write/, f);
  }
  assert.doesNotMatch(readFileSync(new URL('../site/arka-uc.js', import.meta.url), 'utf8'), /innerHTML/);
});
