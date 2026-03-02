// psgcRoutes.js
const express = require('express');
const router = express.Router();
const axios = require('axios');
// Simple in-memory cache to reduce upstream calls and handle transient failures
const cache = new Map(); // key -> { ts, ttl, data }

async function fetchWithRetry(url, opts = {}, attempts = 3) {
  let lastErr;
  for (let i = 0; i < attempts; i++) {
    try {
      const res = await axios.get(url, opts);
      return res;
    } catch (err) {
      lastErr = err;
      // If timeout or network error, wait and retry (exponential backoff)
      const wait = Math.min(2000, 200 * Math.pow(2, i));
      await new Promise(r => setTimeout(r, wait));
    }
  }
  // If we get here, throw the last error
  throw lastErr;
}

function setCache(key, data, ttl = 1000 * 60 * 60) { // default 1 hour
  cache.set(key, { ts: Date.now(), ttl: ttl, data });
}

function getCache(key) {
  const rec = cache.get(key);
  if (!rec) return null;
  if (Date.now() - rec.ts > rec.ttl) { cache.delete(key); return null; }
  return rec.data;
}

// Get all provinces
router.get('/provinces', async (req, res) => {
  try {
    const cacheKey = 'psgc:provinces';
    const cached = getCache(cacheKey);
    let response;
    if (cached) {
      response = { data: cached };
    } else {
      response = await fetchWithRetry('https://psgc.cloud/api/v2/provinces', { timeout: 15000 }, 3);
      // store upstream payload in cache for 1 hour
      setCache(cacheKey, response.data, 1000 * 60 * 60);
    }
    // Normalize upstream payload to an array of province items
    const payload = response.data;
    let provinces = [];
    if (Array.isArray(payload)) provinces = payload;
    else if (payload && Array.isArray(payload.data)) provinces = payload.data;
    else if (payload && Array.isArray(payload.results)) provinces = payload.results;

    // PSGC prefixes for Luzon provinces (top-level two-digit prefixes)
    const luzonProvincePrefixes = ['01','02','03','04','05','06','07','08','09','10','11','12','13','14','15','16','42'];

    const regionHints = ['ilocos','cagayan','central luzon','calabarzon','calabarzon','mimaropa','bicol','cordillera','national capital','ncr','metro manila','car'];
    const luzonProvinces = provinces.filter(p => {
      const code = p.psgc_id || p.psgc || p.province_psgc || p.code || p.id || '';
      const region = (p.region || p.region_name || p.regionName || '').toString().toLowerCase();

      // Match by explicit prefix first
      if (code && luzonProvincePrefixes.some(prefix => String(code).startsWith(prefix))) return true;

      // Otherwise, include if the region string indicates a Luzon region
      if (region) {
        for (const hint of regionHints) {
          if (region.indexOf(hint) !== -1) return true;
        }
      }

      return false;
    });

    // Keep response shape similar to upstream: { data: [...] }
    res.json({ data: luzonProvinces });
  } catch (err) {
    console.error('Error fetching provinces:', (err.response && err.response.status) || err.code || err.message, err.response && err.response.data ? err.response.data : '');
    // Try to return stale cache if available
    const stale = getCache('psgc:provinces');
    if (stale) return res.json({ data: stale });
    const status = err.response && err.response.status ? err.response.status : 502;
    res.status(status).json({ error: 'Failed to fetch provinces', details: err.message });
  }
});

// Get all cities/municipalities
router.get('/cities', async (req, res) => {
  try {
    const cacheKey = 'psgc:cities';
    const cached = getCache(cacheKey);
    let response;
    if (cached) response = { data: cached };
    else {
      response = await fetchWithRetry('https://psgc.cloud/api/v2/cities-municipalities', { timeout: 15000 }, 3);
      setCache(cacheKey, response.data, 1000 * 60 * 60);
    }
    res.json(response.data);
  } catch (err) {
    console.error('Error fetching cities:', (err.response && err.response.status) || err.code || err.message, err.response && err.response.data ? err.response.data : '');
    const stale = getCache('psgc:cities');
    if (stale) return res.json(stale);
    res.status(502).json({ error: 'Failed to fetch cities', details: err.message });
  }
});

// Get all barangays
router.get('/barangays', async (req, res) => {
  try {
    const { city_code } = req.query;

    if (!city_code) {
      return res.status(400).json({ error: 'city_code is required' });
    }

    const cacheKey = `psgc:barangays:${city_code}`;
    const cached = getCache(cacheKey);
    let response;
    if (cached) response = { data: cached };
    else {
      response = await fetchWithRetry(
        `https://psgc.cloud/api/v2/cities-municipalities/${city_code}/barangays`,
        { timeout: 15000 },
        3
      );
      setCache(cacheKey, response.data, 1000 * 60 * 60);
    }

    res.json(response.data);

  } catch (err) {
    console.error('Error fetching barangays:', err.response?.data || err.message);
    res.status(500).json({ error: 'Failed to fetch barangays' });
  }
});


module.exports = router;
