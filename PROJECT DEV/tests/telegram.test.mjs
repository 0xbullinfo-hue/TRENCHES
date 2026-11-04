import test from 'node:test';
import assert from 'node:assert/strict';

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

function formatCallMessage(r) {
  const tps = (r.takeProfits ?? []).map((t) => esc(t.label)).join(' · ') || '—';
  const lines = [
    `🚨 <b>NEW CALL — ${esc(r.ticker)}</b> · ${esc(r.chain)}`,
    `Entry MC ${esc(r.entryMarketCap)} · Risk ${r.risk}/5`,
    `CA: <code>${esc(r.ca)}</code>`,
    `Take Profits: ${tps}`,
  ];
  return lines.join('\n');
}

test('Telegram message formatting and escaping', () => {
  const record = {
    ticker: '<DEGEN>',
    chain: 'SOL & BASE',
    entryMarketCap: '$1.2M',
    risk: 3,
    ca: 'TokenContract123',
    takeProfits: [{ label: 'TP1 <2x>' }, { label: 'TP2 & 5x' }],
  };

  const formatted = formatCallMessage(record);
  assert.equal(formatted.includes('&lt;DEGEN&gt;'), true, 'Ticker with HTML brackets must be escaped');
  assert.equal(formatted.includes('SOL &amp; BASE'), true, 'Ampersands must be escaped');
  assert.equal(formatted.includes('TP1 &lt;2x&gt;'), true, 'Take profit tags must be escaped');
  assert.equal(formatted.includes('TokenContract123'), true, 'CA must be intact');
});
