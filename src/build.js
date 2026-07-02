#!/usr/bin/env node
import { mkdirSync, writeFileSync } from "node:fs";

const LOGIN = process.env.GH_LOGIN ?? "minbgames";
const TOKEN = process.env.GITHUB_TOKEN;
if (!TOKEN) throw new Error("GITHUB_TOKEN is required");

const W = 900;
const H = 470;
const HW = 10;
const HH = 5;
const MAX_H = 42;
const OY = 118;
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const RAMP = [
  [0x37, 0x30, 0xa3],
  [0x7c, 0x3a, 0xed],
  [0xc0, 0x26, 0xd3],
  [0xff, 0x3f, 0xd8],
  [0x00, 0xe5, 0xff],
];

async function Gql(query, variables) {
  const res = await fetch("https://api.github.com/graphql", {
    method: "POST",
    headers: { authorization: `bearer ${TOKEN}`, "content-type": "application/json" },
    body: JSON.stringify({ query, variables }),
  });
  if (!res.ok) throw new Error(`GraphQL HTTP ${res.status}`);
  const json = await res.json();
  if (json.errors) throw new Error(JSON.stringify(json.errors));
  return json.data;
}

async function FetchYears() {
  const meta = await Gql(`query($login:String!){ user(login:$login){ createdAt } }`, { login: LOGIN });
  const firstYear = new Date(meta.user.createdAt).getUTCFullYear();
  const nowYear = new Date().getUTCFullYear();
  const years = [];
  for (let y = nowYear; y >= firstYear; y--) years.push(y);

  const parts = years.map((y) => {
    const to = y === nowYear ? new Date().toISOString() : `${y}-12-31T23:59:59Z`;
    return `y${y}: contributionsCollection(from:"${y}-01-01T00:00:00Z", to:"${to}"){
      contributionCalendar{ totalContributions weeks{ contributionDays{ date contributionCount } } }
    }`;
  });
  const data = await Gql(`query($login:String!){ user(login:$login){ ${parts.join("\n")} } }`, { login: LOGIN });
  return years.map((y) => ({ year: y, cal: data.user[`y${y}`].contributionCalendar }));
}

function Mulberry32(seed) {
  return function () {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function RampColor(t) {
  const p = t * (RAMP.length - 1);
  const i = Math.min(RAMP.length - 2, Math.floor(p));
  const f = p - i;
  return RAMP[i].map((v, k) => v + (RAMP[i + 1][k] - v) * f);
}

function Rgb(c, f) {
  return `rgb(${c.map((v) => Math.min(255, Math.round(v * f))).join(",")})`;
}

function BuildGrid(cal, year) {
  const counts = new Map();
  for (const w of cal.weeks) for (const d of w.contributionDays) counts.set(d.date, d.contributionCount);
  const today = new Date().toISOString().slice(0, 10);
  const grid = [];
  let w = 0;
  const cur = new Date(Date.UTC(year, 0, 1));
  while (cur.getUTCFullYear() === year) {
    const iso = cur.toISOString().slice(0, 10);
    const dow = cur.getUTCDay();
    if (dow === 0 && !(cur.getUTCMonth() === 0 && cur.getUTCDate() === 1)) w++;
    (grid[w] ??= [])[dow] = { date: iso, count: iso > today ? -1 : (counts.get(iso) ?? 0) };
    cur.setUTCDate(cur.getUTCDate() + 1);
  }
  return grid;
}

function CalcStats(grid) {
  const days = grid.flat().filter((d) => d && d.count >= 0);
  let longest = 0;
  let run = 0;
  let peak = { date: null, count: 0 };
  for (const d of days) {
    run = d.count > 0 ? run + 1 : 0;
    longest = Math.max(longest, run);
    if (d.count > peak.count) peak = { date: d.date, count: d.count };
  }
  const active = days.filter((d) => d.count > 0).length;
  return { longest, peak, active, total: days.reduce((a, d) => a + d.count, 0) };
}

function FmtDate(iso) {
  const d = new Date(`${iso}T00:00:00Z`);
  return `${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()}`;
}

function RenderStars(seed) {
  const rng = Mulberry32(seed);
  let out = "";
  for (let i = 0; i < 70; i++) {
    const x = (14 + rng() * (W - 28)).toFixed(1);
    const y = (12 + rng() * 130).toFixed(1);
    const r = (rng() * 1.1 + 0.4).toFixed(2);
    out += `<circle class="s" cx="${x}" cy="${y}" r="${r}" fill="#cfe8ff" style="animation-duration:${(rng() * 3 + 2).toFixed(1)}s;animation-delay:${(rng() * 4).toFixed(1)}s"/>`;
  }
  return out;
}

function RenderPlatform(ox, maxW) {
  const pts = [
    [ox, OY - HH],
    [ox + maxW * HW + HW, OY + maxW * HH],
    [ox + (maxW - 6) * HW, OY + (maxW + 6) * HH + HH],
    [ox - 6 * HW - HW, OY + 6 * HH],
  ];
  const cx = pts.reduce((a, p) => a + p[0], 0) / 4;
  const cy = pts.reduce((a, p) => a + p[1], 0) / 4;
  const grow = (f) => pts.map((p) => `${(cx + (p[0] - cx) * f).toFixed(1)},${(cy + (p[1] - cy) * f).toFixed(1)}`).join(" ");
  return `<polygon points="${grow(1.1)}" transform="translate(0 7)" fill="#050512" opacity="0.9"/>
  <polygon points="${grow(1.1)}" fill="#0b0b22" stroke="url(#hz)" stroke-width="1.4" opacity="0.95" filter="url(#glow)"/>`;
}

function RenderCube(cx, cy, h, base, glow, title, rng) {
  const f = (n) => +n.toFixed(1);
  const top = `M${f(cx)} ${f(cy - HH - h)}L${f(cx + HW)} ${f(cy - h)}L${f(cx)} ${f(cy + HH - h)}L${f(cx - HW)} ${f(cy - h)}Z`;
  if (h === 0) return `<g><title>${title}</title><path d="${top}" fill="${base}" stroke="#26264f" stroke-width="0.5"/></g>`;
  const right = `M${f(cx + HW)} ${f(cy - h)}L${f(cx)} ${f(cy + HH - h)}L${f(cx)} ${f(cy + HH)}L${f(cx + HW)} ${f(cy)}Z`;
  const left = `M${f(cx - HW)} ${f(cy - h)}L${f(cx)} ${f(cy + HH - h)}L${f(cx)} ${f(cy + HH)}L${f(cx - HW)} ${f(cy)}Z`;
  const c = RampColor(glow.t);
  const pulse = glow.t >= 0.72 ? ` class="gp" style="animation-delay:${(rng() * 3).toFixed(1)}s" filter="url(#glow)"` : "";
  return `<g><title>${title}</title>
    <path d="${left}" fill="${Rgb(c, 0.42)}"/>
    <path d="${right}" fill="${Rgb(c, 0.72)}"/>
    <path d="${top}" fill="${Rgb(c, 1.18)}"${pulse}/>
  </g>`;
}

function RenderTerrain(grid, ox, maxCount) {
  const rng = Mulberry32(4242);
  const maxW = grid.length - 1;
  let out = "";
  for (let s = 0; s <= maxW + 6; s++) {
    for (let d = 6; d >= 0; d--) {
      const w = s - d;
      if (w < 0 || w > maxW) continue;
      const day = grid[w]?.[d];
      if (!day) continue;
      const cx = ox + (w - d) * HW;
      const cy = OY + (w + d) * HH;
      if (day.count === -1) {
        out += `<path d="M${cx} ${cy - HH}L${cx + HW} ${cy}L${cx} ${cy + HH}L${cx - HW} ${cy}Z" fill="#0c0c24" stroke="#1c1c3e" stroke-width="0.5"/>`;
        continue;
      }
      const title = `${day.date} · ${day.count} commit${day.count === 1 ? "" : "s"}`;
      if (day.count === 0) {
        out += RenderCube(cx, cy, 0, "#16163a", { t: 0 }, title, rng);
        continue;
      }
      const t = Math.pow(day.count / maxCount, 0.6);
      const h = Math.round((4 + t * (MAX_H - 4)) * 10) / 10;
      out += RenderCube(cx, cy, h, "", { t }, title, rng);
    }
  }
  return out;
}

function RenderSvg(year, grid, stats, isCurrent) {
  const maxW = grid.length - 1;
  const ox = Math.round(W / 2 - ((maxW - 6) / 2) * HW);
  const maxCount = Math.max(1, ...grid.flat().filter(Boolean).map((d) => d.count));
  const updated = new Date().toISOString().slice(0, 10);
  const peakLabel = stats.peak.date ? `PEAK ${stats.peak.count}/DAY (${FmtDate(stats.peak.date).toUpperCase()})` : "PEAK —";
  const range = isCurrent ? `JAN 1 → ${FmtDate(updated).toUpperCase()}` : `FULL YEAR`;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" aria-label="${LOGIN} ${year} contributions in 3D">
<defs>
  <linearGradient id="sky" x1="0" y1="0" x2="0" y2="1">
    <stop offset="0" stop-color="#050514"/>
    <stop offset="0.6" stop-color="#0e0b30"/>
    <stop offset="1" stop-color="#26104b"/>
  </linearGradient>
  <linearGradient id="hz" x1="0" y1="0" x2="1" y2="0">
    <stop offset="0" stop-color="#00e5ff"/>
    <stop offset="0.5" stop-color="#ff3fd8"/>
    <stop offset="1" stop-color="#9d5cff"/>
  </linearGradient>
  <linearGradient id="tail" x1="0" y1="0" x2="1" y2="0">
    <stop offset="0" stop-color="#fff" stop-opacity="0"/>
    <stop offset="1" stop-color="#cfe8ff"/>
  </linearGradient>
  <filter id="glow" x="-60%" y="-60%" width="220%" height="220%">
    <feGaussianBlur stdDeviation="2" result="b"/>
    <feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge>
  </filter>
</defs>
<style>
  text{font-family:'JetBrains Mono','Fira Code',ui-monospace,monospace}
  .title{font-size:26px;font-weight:700;letter-spacing:7px;fill:#00e5ff;animation:fk 7s infinite}
  .sub{font-size:10px;letter-spacing:3px;fill:#8888c8}
  .year{font-size:44px;font-weight:700;letter-spacing:3px;fill:#ff3fd8}
  .total{font-size:13px;letter-spacing:2px;fill:#9d8fe0}
  .stats{font-size:11px;letter-spacing:2px;fill:#6fb9d4}
  .s{animation:tw 3s ease-in-out infinite both}
  .gp{animation:gp 3.2s ease-in-out infinite}
  .shoot{animation:sh 13s linear infinite}
  @keyframes tw{0%,100%{opacity:.12}50%{opacity:.9}}
  @keyframes gp{0%,100%{opacity:1}50%{opacity:.62}}
  @keyframes fk{0%,100%{opacity:1}3%{opacity:.55}5%{opacity:1}54%{opacity:1}55%{opacity:.5}57%{opacity:1}}
  @keyframes sh{0%,88%{transform:translate(140px,26px);opacity:0}90%{opacity:1}100%{transform:translate(520px,140px);opacity:0}}
</style>
<rect width="${W}" height="${H}" fill="url(#sky)"/>
${RenderStars(year)}
<g>
  <circle cx="560" cy="62" r="34" fill="#f5ecd7" opacity="0.07"/>
  <circle cx="560" cy="62" r="20" fill="#f5ecd7" opacity="0.9"/>
  <circle cx="569" cy="55" r="17" fill="#0e0b30"/>
</g>
<g class="shoot"><line x1="0" y1="0" x2="64" y2="22" stroke="url(#tail)" stroke-width="1.5" stroke-linecap="round"/></g>
${RenderPlatform(ox, maxW)}
${RenderTerrain(grid, ox, maxCount)}
<text class="title" x="34" y="52" filter="url(#glow)">${LOGIN.toUpperCase()}</text>
<text class="sub" x="34" y="74">3D COMMIT TERRAIN · ${range} · REBUILT NIGHTLY</text>
<text class="year" x="${W - 34}" y="58" text-anchor="end" filter="url(#glow)">${year}</text>
<text class="total" x="${W - 34}" y="82" text-anchor="end">${stats.total.toLocaleString("en-US")} CONTRIBUTIONS</text>
<text class="stats" x="${W / 2}" y="${H - 14}" text-anchor="middle">ACTIVE ${stats.active}D · LONGEST STREAK ${stats.longest}D · ${peakLabel} · SYNCED ${updated}</text>
</svg>`;
}

function RenderReadme(results) {
  const [head, ...rest] = results;
  const details = rest
    .map(
      (r) =>
        `<details><summary><b>${r.year}</b> — ${r.stats.total.toLocaleString("en-US")} contributions</summary><br/><img src="dist/y${r.year}.svg" width="100%" alt="${r.year} contribution terrain"/></details>`
    )
    .join("\n");
  return `<div align="center">

<img src="dist/y${head.year}.svg" width="100%" alt="${head.year} contribution terrain" />

${details}

<sub>

**3D COMMIT TERRAIN** — every day of the year as a voxel, height & color follow commit count.<br/>
Hand-built SVG generator, zero dependencies, redrawn every night by [a single script](src/build.js).

</sub>

</div>
`;
}

const nowYear = new Date().getUTCFullYear();
const yearData = await FetchYears();
mkdirSync("dist", { recursive: true });
const results = [];
for (const { year, cal } of yearData) {
  const grid = BuildGrid(cal, year);
  const stats = CalcStats(grid);
  const svg = RenderSvg(year, grid, stats, year === nowYear);
  writeFileSync(`dist/y${year}.svg`, svg);
  results.push({ year, stats });
  console.log(`y${year}.svg → ${stats.total} contributions, ${(svg.length / 1024).toFixed(1)} KB`);
}
writeFileSync("README.md", RenderReadme(results));
console.log(`README.md → ${results.length} years`);
