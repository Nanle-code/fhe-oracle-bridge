/**
 * Live spot prices (CoinGecko + Binance average). Used by feeder, Wave 4, and submitPrice on testnets.
 */

const FETCH_UA = { "User-Agent": "fhe-oracle-bridge/1.0 (live spot; public APIs)" };

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function fetchWithTimeout(url, opts = {}, timeoutMs = 20000) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    return await fetch(url, { ...opts, signal: ctrl.signal, headers: { ...FETCH_UA, ...(opts.headers || {}) } });
  } finally {
    clearTimeout(t);
  }
}

async function fetchJsonRetry(url, attempts = 4) {
  let last;
  for (let i = 0; i < attempts; i++) {
    try {
      const res = await fetchWithTimeout(url, { headers: { accept: "application/json" } });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return await res.json();
    } catch (e) {
      last = e;
      if (i < attempts - 1) await sleep(800 * (i + 1));
    }
  }
  throw last;
}

async function fetchCoingeckoEthBtc() {
  const url = "https://api.coingecko.com/api/v3/simple/price?ids=ethereum,bitcoin&vs_currencies=usd";
  const data = await fetchJsonRetry(url);
  const eth = data?.ethereum?.usd;
  const btc = data?.bitcoin?.usd;
  if (typeof eth !== "number" || typeof btc !== "number") throw new Error("CoinGecko: missing ethereum/bitcoin usd");
  return { eth, btc, source: "coingecko" };
}

async function fetchBinanceEthBtc() {
  const base = "https://api.binance.com/api/v3/ticker/price";
  const [ethJ, btcJ] = await Promise.all([
    fetchJsonRetry(`${base}?symbol=ETHUSDT`),
    fetchJsonRetry(`${base}?symbol=BTCUSDT`),
  ]);
  const eth = Number.parseFloat(ethJ.price);
  const btc = Number.parseFloat(btcJ.price);
  if (!Number.isFinite(eth) || !Number.isFinite(btc)) throw new Error("Binance: invalid price");
  return { eth, btc, source: "binance" };
}

function usdToUint8Decimals(usd) {
  if (!Number.isFinite(usd) || usd < 0) throw new Error(`Invalid USD: ${usd}`);
  const scaled = Math.round(usd * 1e8);
  if (scaled > Number.MAX_SAFE_INTEGER) throw new Error("Price too large for safe integer rounding");
  return BigInt(scaled);
}

function uint8DecimalsToUsd(n) {
  return Number(n) / 1e8;
}

/**
 * @returns {{ ethUsd: number, btcUsd: number, sources: string[], ethUint: bigint, btcUint: bigint }}
 */
async function fetchAveragedPrices() {
  const results = await Promise.allSettled([fetchCoingeckoEthBtc(), fetchBinanceEthBtc()]);
  const ok = [];
  for (const r of results) {
    if (r.status === "fulfilled") ok.push(r.value);
  }
  if (ok.length === 0) {
    await sleep(1500);
    const retry = await Promise.allSettled([fetchCoingeckoEthBtc(), fetchBinanceEthBtc()]);
    for (const r of retry) {
      if (r.status === "fulfilled") ok.push(r.value);
    }
  }
  if (ok.length === 0) throw new Error("All live price sources failed");
  let sumEth = 0;
  let sumBtc = 0;
  for (const o of ok) {
    sumEth += o.eth;
    sumBtc += o.btc;
  }
  const ethUsd = sumEth / ok.length;
  const btcUsd = sumBtc / ok.length;
  return {
    ethUsd,
    btcUsd,
    sources: ok.map((o) => o.source),
    ethUint: usdToUint8Decimals(ethUsd),
    btcUint: usdToUint8Decimals(btcUsd),
  };
}

module.exports = {
  fetchAveragedPrices,
  usdToUint8Decimals,
  uint8DecimalsToUsd,
};
