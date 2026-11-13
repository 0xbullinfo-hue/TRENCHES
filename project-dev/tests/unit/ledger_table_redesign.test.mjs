import test from 'node:test';
import assert from 'node:assert/strict';
import {
  calculatePnL,
  getDexScreenerUrl,
  formatTicker,
  formatMultiplier,
  formatMarketCap,
  formatChainLabel,
  SUPPORTED_DEXSCREENER_CHAINS,
} from '../../src/lib/ledger/format.ts';
import { installDomShim } from './helpers/dom-shim.mjs';

const dom = installDomShim();
if (typeof globalThis.self === 'undefined') {
  globalThis.self = globalThis;
}

const React = await import('react');
const { act } = React;
const { createRoot } = await import('react-dom/client');
const { LedgerTableRow } = await import('../../src/components/ledger/LedgerCard.tsx');
const { LedgerTableSkeleton } = await import('../../src/components/ledger/LedgerCardSkeleton.tsx');

test('Ledger Table Redesign [1/6]: PnL calculations for values below, equal to, and above 1x', () => {
  // 1x = 0%
  const pnl1x = calculatePnL('1x');
  assert.equal(pnl1x.formatted, '0%');
  assert.equal(pnl1x.sign, 'zero');
  assert.equal(pnl1x.value, 0);

  const pnl1xNum = calculatePnL(1);
  assert.equal(pnl1xNum.formatted, '0%');
  assert.equal(pnl1xNum.sign, 'zero');

  // 1.5x = +50%
  const pnl15 = calculatePnL('1.5x');
  assert.equal(pnl15.formatted, '+50%');
  assert.equal(pnl15.sign, 'positive');
  assert.equal(pnl15.value, 50);

  // 2x = +100%
  const pnl2x = calculatePnL('2x');
  assert.equal(pnl2x.formatted, '+100%');
  assert.equal(pnl2x.sign, 'positive');
  assert.equal(pnl2x.value, 100);

  // 5x = +400%
  const pnl5x = calculatePnL(5);
  assert.equal(pnl5x.formatted, '+400%');
  assert.equal(pnl5x.sign, 'positive');
  assert.equal(pnl5x.value, 400);

  // 10x = +900%
  const pnl10x = calculatePnL('10x');
  assert.equal(pnl10x.formatted, '+900%');
  assert.equal(pnl10x.sign, 'positive');

  // 0.5x = -50%
  const pnl05 = calculatePnL('0.5x');
  assert.equal(pnl05.formatted, '-50%');
  assert.equal(pnl05.sign, 'negative');
  assert.equal(pnl05.value, -50);

  // 0.75x = -25%
  const pnl075 = calculatePnL(0.75);
  assert.equal(pnl075.formatted, '-25%');
  assert.equal(pnl075.sign, 'negative');

  // Missing, invalid, or negative values render safely as —
  assert.equal(calculatePnL(null).formatted, '—');
  assert.equal(calculatePnL(undefined).formatted, '—');
  assert.equal(calculatePnL('').formatted, '—');
  assert.equal(calculatePnL('invalid').formatted, '—');
  assert.equal(calculatePnL(-2).formatted, '—');
  assert.equal(calculatePnL(0).formatted, '—');
});

test('Ledger Table Redesign [2/6]: DexScreener link generation and chain mapping', () => {
  // Solana mapping
  assert.equal(
    getDexScreenerUrl('solana', 'EM9M8RaxSjSf2UT2e2xndaBjjC1ijkT2nH5U3j6epump'),
    'https://dexscreener.com/solana/EM9M8RaxSjSf2UT2e2xndaBjjC1ijkT2nH5U3j6epump'
  );
  assert.equal(
    getDexScreenerUrl('SOL', 'EM9M8RaxSjSf2UT2e2xndaBjjC1ijkT2nH5U3j6epump'),
    'https://dexscreener.com/solana/EM9M8RaxSjSf2UT2e2xndaBjjC1ijkT2nH5U3j6epump'
  );

  // Ethereum mapping
  assert.equal(
    getDexScreenerUrl('ethereum', '0x1234567890123456789012345678901234567890'),
    'https://dexscreener.com/ethereum/0x1234567890123456789012345678901234567890'
  );
  assert.equal(
    getDexScreenerUrl('eth', '0x1234567890123456789012345678901234567890'),
    'https://dexscreener.com/ethereum/0x1234567890123456789012345678901234567890'
  );

  // Base mapping
  assert.equal(
    getDexScreenerUrl('base', '0x1234567890123456789012345678901234567890'),
    'https://dexscreener.com/base/0x1234567890123456789012345678901234567890'
  );

  // BSC mapping
  assert.equal(
    getDexScreenerUrl('bsc', '0x1234567890123456789012345678901234567890'),
    'https://dexscreener.com/bsc/0x1234567890123456789012345678901234567890'
  );

  // Unsupported chains or missing data produce null (renders —)
  assert.equal(getDexScreenerUrl('other', 'some_address'), null);
  assert.equal(getDexScreenerUrl('unsupported_chain', '0x123'), null);
  assert.equal(getDexScreenerUrl('solana', ''), null);
  assert.equal(getDexScreenerUrl('solana', '   '), null);
  assert.equal(getDexScreenerUrl(null, '0x123'), null);
  assert.equal(getDexScreenerUrl('base', null), null);
});

test('Ledger Table Redesign [3/6]: Single row rendering with exact 6 columns in order', async () => {
  const container = dom.document.createElement('div');
  dom.document.body.appendChild(container);

  const mockEntry = {
    id: 'ledger-entry-1',
    ticker: 'PEPE',
    chain: 'ethereum',
    contract_address: '0x6982508145454ce325ddbe47a25d4ec3d2311933',
    multiplier: '5.5x',
    entry_price: '$500K',
    exit_price: '$2.75M',
    closed_at: '2026-11-01T00:00:00.000Z',
    posted_at: '2026-10-31T00:00:00.000Z',
  };

  let root;
  await act(async () => {
    root = createRoot(container);
    root.render(
      React.createElement(
        'table',
        null,
        React.createElement(
          'tbody',
          null,
          React.createElement(LedgerTableRow, { entry: mockEntry })
        )
      )
    );
  });

  const row = container.querySelector('tr');
  assert.ok(row, 'Row must exist');

  const cells = row.querySelectorAll('td');
  assert.equal(cells.length, 6, 'Must have exactly 6 table cells');

  // Column 1: Ticker
  assert.ok(cells[0].textContent.includes('$PEPE'), 'Column 1 must display formatted ticker $PEPE');
  assert.ok(cells[0].textContent.includes('Ethereum'), 'Column 1 displays chain label');

  // Column 2: Entry MCAP
  assert.ok(cells[1].textContent.includes('$500K'), 'Column 2 must display entry MCAP $500K');

  // Column 3: Exit MCAP
  assert.ok(cells[2].textContent.includes('$2.75M'), 'Column 3 must display exit MCAP $2.75M');

  // Column 4: Multiplier
  assert.ok(cells[3].textContent.includes('5.5x'), 'Column 4 must display formatted multiplier 5.5x');

  // Column 5: PnL
  assert.ok(cells[4].textContent.includes('+450%'), 'Column 5 must display calculated PnL +450%');

  // Column 6: DexScreener link
  const link = cells[5].querySelector('a');
  assert.ok(link, 'Column 6 must contain a link');
  assert.equal(
    link.getAttribute('href'),
    'https://dexscreener.com/ethereum/0x6982508145454ce325ddbe47a25d4ec3d2311933'
  );
  assert.equal(link.getAttribute('target'), '_blank');
  assert.ok(link.getAttribute('rel').includes('noopener'));
  assert.ok(link.getAttribute('rel').includes('noreferrer'));
  assert.ok(link.textContent.includes('View'));
  assert.equal(link.getAttribute('aria-label'), 'View $PEPE on DexScreener');

  await act(async () => {
    root.unmount();
  });
  dom.document.body.removeChild(container);
});

test('Ledger Table Redesign [4/6]: Missing values render safely as em-dash (—)', async () => {
  const container = dom.document.createElement('div');
  dom.document.body.appendChild(container);

  const incompleteEntry = {
    id: 'ledger-entry-missing',
    ticker: 'MYSTERY',
    chain: 'other', // unsupported chain -> no DexScreener link
    contract_address: '', // empty CA -> no DexScreener link
    multiplier: 'invalid-mult',
    entry_price: null,
    exit_price: null,
    closed_at: '2026-11-01T00:00:00.000Z',
    posted_at: '2026-10-31T00:00:00.000Z',
  };

  let root;
  await act(async () => {
    root = createRoot(container);
    root.render(
      React.createElement(
        'table',
        null,
        React.createElement(
          'tbody',
          null,
          React.createElement(LedgerTableRow, { entry: incompleteEntry })
        )
      )
    );
  });

  const cells = container.querySelectorAll('td');
  assert.equal(cells.length, 6);

  // Column 1: Ticker
  assert.ok(cells[0].textContent.includes('$MYSTERY'));

  // Column 2: Entry MCAP missing -> —
  assert.ok(cells[1].textContent.includes('—'), 'Missing Entry MCAP displays —');

  // Column 3: Exit MCAP missing -> —
  assert.ok(cells[2].textContent.includes('—'), 'Missing Exit MCAP displays —');

  // Column 4: Multiplier fallback -> 1.0x
  assert.ok(cells[3].textContent.includes('1.0x'));

  // Column 5: PnL invalid -> —
  assert.ok(cells[4].textContent.includes('—'), 'Invalid multiplier PnL displays —');

  // Column 6: DexScreener unsupported chain & missing CA -> —
  assert.ok(cells[5].textContent.includes('—'), 'Unsupported chain DexScreener displays —');
  assert.equal(cells[5].querySelector('a'), null, 'No link should be rendered when unsupported');

  await act(async () => {
    root.unmount();
  });
  dom.document.body.removeChild(container);
});

test('Ledger Table Redesign [5/6]: Table skeleton renders 6 header placeholders and multiple row placeholders', async () => {
  const container = dom.document.createElement('div');
  dom.document.body.appendChild(container);

  let root;
  await act(async () => {
    root = createRoot(container);
    root.render(React.createElement(LedgerTableSkeleton, { rowCount: 5 }));
  });

  const table = container.querySelector('table');
  assert.ok(table, 'Skeleton must be a table element');

  const headers = table.querySelectorAll('th');
  assert.equal(headers.length, 6, 'Skeleton must have exactly 6 header columns');

  const tbody = table.querySelector('tbody');
  assert.ok(tbody, 'Table must contain tbody');
  const rows = tbody.querySelectorAll('tr');
  assert.equal(rows.length, 5, 'Skeleton must render 5 placeholder rows');

  await act(async () => {
    root.unmount();
  });
  dom.document.body.removeChild(container);
});

test('Ledger Table Redesign [6/6]: Ticker, MarketCap, and Multiplier formatters preserved', () => {
  // formatTicker
  assert.equal(formatTicker('solx'), '$SOLX');
  assert.equal(formatTicker('$solx'), '$SOLX');
  assert.equal(formatTicker('BONK'), '$BONK');

  // formatMultiplier
  assert.equal(formatMultiplier('2'), '2x');
  assert.equal(formatMultiplier(2), '2x');
  assert.equal(formatMultiplier('5.5'), '5.5x');
  assert.equal(formatMultiplier('10.00'), '10x');
  assert.equal(formatMultiplier('invalid'), '1.0x');

  // formatMarketCap
  assert.equal(formatMarketCap('$150K'), '$150K');
  assert.equal(formatMarketCap('150k'), '$150K');
  assert.equal(formatMarketCap('$2.5M'), '$2.5M');
  assert.equal(formatMarketCap(null), '—');
  assert.equal(formatMarketCap(''), '—');
});

test('Ledger Table Redesign [7/7]: LedgerGrid table headers, row counts, and dashboard embed compatibility', async () => {
  const { LedgerGrid } = await import('../../src/components/ledger/LedgerGrid.tsx');

  const container = dom.document.createElement('div');
  dom.document.body.appendChild(container);

  const mockEntries = [
    {
      id: 'entry-1',
      ticker: 'SOLX',
      chain: 'solana',
      contract_address: 'EM9M8RaxSjSf2UT2e2xndaBjjC1ijkT2nH5U3j6epump',
      multiplier: '3x',
      entry_price: '$100K',
      exit_price: '$300K',
      closed_at: '2026-11-01T00:00:00.000Z',
      posted_at: '2026-10-31T00:00:00.000Z',
    },
    {
      id: 'entry-2',
      ticker: 'BASEMEME',
      chain: 'base',
      contract_address: '0x1234567890123456789012345678901234567890',
      multiplier: '10x',
      entry_price: '$50K',
      exit_price: '$500K',
      closed_at: '2026-11-02T00:00:00.000Z',
      posted_at: '2026-11-01T00:00:00.000Z',
    },
    {
      id: 'entry-3',
      ticker: 'LOSSCOIN',
      chain: 'bsc',
      contract_address: '0x9999999999999999999999999999999999999999',
      multiplier: '0.5x',
      entry_price: '$200K',
      exit_price: '$100K',
      closed_at: '2026-11-03T00:00:00.000Z',
      posted_at: '2026-11-02T00:00:00.000Z',
    },
  ];

  let root;
  await act(async () => {
    root = createRoot(container);
    root.render(
      React.createElement(LedgerGrid, {
        initialEntries: mockEntries,
        initialTotal: 3,
        initialHasMore: false,
        isDashboardEmbed: true,
      })
    );
  });

  // Verify headers in exact order: Ticker, Entry MCAP, Exit MCAP, Multiplier, PnL, DexScreener
  const thElements = container.querySelectorAll('th');
  assert.equal(thElements.length, 6, 'Must have exactly 6 table header columns');
  const headerTexts = Array.from(thElements).map((th) => th.textContent.trim());
  assert.deepEqual(headerTexts, [
    'Ticker',
    'Entry MCAP',
    'Exit MCAP',
    'Multiplier',
    'PnL',
    'DexScreener',
  ]);

  // Verify exactly 3 data rows in tbody
  const tbody = container.querySelector('tbody');
  assert.ok(tbody, 'Table body must exist');
  const rows = tbody.querySelectorAll('tr');
  assert.equal(rows.length, 3, 'Every record must render as exactly one table row');

  // Verify each row data
  // Row 1: SOLX
  assert.ok(rows[0].textContent.includes('$SOLX'));
  assert.ok(rows[0].textContent.includes('+200%'));
  // Row 2: BASEMEME
  assert.ok(rows[1].textContent.includes('$BASEMEME'));
  assert.ok(rows[1].textContent.includes('+900%'));
  // Row 3: LOSSCOIN
  assert.ok(rows[2].textContent.includes('$LOSSCOIN'));
  assert.ok(rows[2].textContent.includes('-50%'));

  // Verify honesty caption
  assert.ok(
    container.textContent.includes('Recorded by the TrenchLabs team'),
    'Table must include team recording disclosure'
  );

  // Verify dashboard embed link to full ledger
  assert.ok(
    container.textContent.includes('View full ledger'),
    'Dashboard embed must provide full ledger link'
  );

  await act(async () => {
    root.unmount();
  });
  dom.document.body.removeChild(container);
});
