/**
 * Exact integer-based token and basis-point math utilities.
 * Never mixes floating-point arithmetic into atomic token conversions.
 */

const DECIMAL_RE = /^(-)?(?:(\d+)(?:\.(\d*))?|\.(\d+))$/;

function expandScientific(raw: string): string {
  const trimmed = raw.trim().replace(/,/g, '');
  if (!/[eE]/.test(trimmed)) return trimmed;

  const match = /^([+-])?(\d+)(?:\.(\d*))?[eE]([+-]?\d+)$/.exec(trimmed);
  if (!match) return trimmed;

  const sign = match[1] === '-' ? '-' : '';
  const intPart = match[2] ?? '';
  const fracPart = match[3] ?? '';
  const exp = Number.parseInt(match[4] ?? '0', 10);
  if (!Number.isFinite(exp)) return trimmed;

  const digits = `${intPart}${fracPart}`;
  const decimalIndex = intPart.length + exp;

  if (decimalIndex <= 0) {
    return `${sign}0.${'0'.repeat(Math.abs(decimalIndex))}${digits}`;
  }
  if (decimalIndex >= digits.length) {
    return `${sign}${digits}${'0'.repeat(decimalIndex - digits.length)}`;
  }
  return `${sign}${digits.slice(0, decimalIndex)}.${digits.slice(decimalIndex)}`;
}

function validateDecimals(decimals: number): number {
  if (!Number.isInteger(decimals) || decimals < 0 || decimals > 36) {
    throw new RangeError(`Invalid token decimals: ${decimals}`);
  }
  return decimals;
}

/**
 * Parses a decimal string or finite number into base atomic units (`bigint`).
 * Excess fractional digits beyond `decimals` are truncated toward zero.
 */
export function parseUnits(amount: string | number, decimals: number): bigint {
  const safeDecimals = validateDecimals(decimals);
  let normalized: string;

  if (typeof amount === 'number') {
    if (!Number.isFinite(amount)) {
      throw new RangeError(`Cannot parse non-finite number: ${amount}`);
    }
    normalized = Object.is(amount, -0) ? '0' : expandScientific(amount.toString());
  } else {
    normalized = expandScientific(amount);
  }

  const parsed = DECIMAL_RE.exec(normalized);
  if (!parsed) {
    throw new SyntaxError(`Invalid decimal token amount: "${String(amount)}"`);
  }

  const isNegative = Boolean(parsed[1]);
  const whole = parsed[2] ?? '0';
  const frac = parsed[3] ?? parsed[4] ?? '';
  const paddedFrac = (frac + '0'.repeat(safeDecimals)).slice(0, safeDecimals);
  const raw = BigInt(`${whole}${paddedFrac}`);

  if (raw === 0n) return 0n;
  return isNegative ? -raw : raw;
}

export interface FormatUnitsOptions {
  /** Maximum number of fractional digits to display (default: `decimals`). */
  maxFractionDigits?: number;
  /** Strip insignificant trailing fractional zeros (default: `true`). */
  trimTrailingZeros?: boolean;
}

/**
 * Formats atomic token units (`bigint`) into a human-readable decimal string.
 */
export function formatUnits(
  value: bigint,
  decimals: number,
  options: FormatUnitsOptions = {}
): string {
  const safeDecimals = validateDecimals(decimals);
  const { maxFractionDigits = safeDecimals, trimTrailingZeros = true } = options;
  const displayDecimals = Math.max(0, Math.min(safeDecimals, Math.trunc(maxFractionDigits)));

  const negative = value < 0n;
  const abs = negative ? -value : value;
  const base = 10n ** BigInt(safeDecimals);
  const whole = abs / base;
  const frac = abs % base;

  let fracStr =
    safeDecimals > 0 && displayDecimals > 0
      ? frac.toString().padStart(safeDecimals, '0').slice(0, displayDecimals)
      : '';

  if (trimTrailingZeros && fracStr) {
    fracStr = fracStr.replace(/0+$/, '');
  }

  const body = fracStr ? `${whole}.${fracStr}` : whole.toString();
  return negative && (whole > 0n || fracStr.replace(/0/g, '').length > 0) ? `-${body}` : body;
}

/**
 * Formats atomic token units with thousands grouping on the integer part.
 */
export function formatTokenAmount(
  value: bigint,
  decimals: number,
  maxFractionDigits = 4
): string {
  const formatted = formatUnits(value, decimals, {
    maxFractionDigits,
    trimTrailingZeros: true,
  });

  const negative = formatted.startsWith('-');
  const unsigned = negative ? formatted.slice(1) : formatted;
  const [wholePart = '0', fracPart] = unsigned.split('.');

  const groupedWhole = wholePart.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  const joined = fracPart ? `${groupedWhole}.${fracPart}` : groupedWhole;
  return negative && joined !== '0' ? `-${joined}` : joined;
}

/**
 * Computes `(a * b) / denominator` cleanly in arbitrary-precision BigInt math.
 */
export function mulDiv(a: bigint, b: bigint, denominator: bigint): bigint {
  if (denominator === 0n) {
    throw new RangeError('Division by zero in mulDiv');
  }
  return (a * b) / denominator;
}

/**
 * Applies basis points (1 bps = 0.01% = 1 / 10_000) to an atomic token amount.
 */
export function bps(amount: bigint, basisPoints: bigint | number): bigint {
  const bp =
    typeof basisPoints === 'bigint'
      ? basisPoints
      : Number.isFinite(basisPoints)
        ? BigInt(Math.trunc(basisPoints))
        : (() => {
            throw new RangeError(`Invalid basis points: ${basisPoints}`);
          })();

  return mulDiv(amount, bp, 10_000n);
}

/**
 * Clamps a `bigint` inclusively within `[min, max]`.
 */
export function clampBigInt(value: bigint, min: bigint, max: bigint): bigint {
  if (min > max) {
    throw new RangeError(`clampBigInt invalid range: min (${min}) > max (${max})`);
  }
  if (value < min) return min;
  if (value > max) return max;
  return value;
}

/**
 * Returns true if the atomic amount is strictly greater than zero.
 */
export function isPositive(value: bigint): boolean {
  return value > 0n;
}
