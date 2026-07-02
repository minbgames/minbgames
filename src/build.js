#!/usr/bin/env node
import { mkdirSync, writeFileSync } from "node:fs";

const LOGIN = process.env.GH_LOGIN ?? "minbgames";
const TOKEN = process.env.GITHUB_TOKEN;
if (!TOKEN) throw new Error("GITHUB_TOKEN is required");

const W = 1080;
const H = 480;
const HORIZON = 350;
const PLOT_X = 40;
const PLOT_W = 1000;
const MAX_H = 218;
const MIN_H = 10;
const NEON = ["#00e5ff", "#ff3fd8", "#9d5cff", "#3cf5c5", "#ffb443"];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

const QUERY = `query($login:String!){
  user(login:$login){
    contributionsCollection{
      contributionCalendar{
        totalContributions
        weeks{ contributionDays{ date contributionCount } }
      }
    }
  }
}`;

async function FetchCalendar() {
  const res = await fetch("https://api.github.com/graphql", {
    method: "POST",
    headers: { authorization: `bearer ${TOKEN}`, "content-type": "application/json" },
    body: JSON.stringify({ query: QUERY, variables: { login: LOGIN } }),
  });
  if (!res.ok) throw new Error(`GraphQL HTTP ${res.status}`);
  const json = await res.json();
  if (json.errors) throw new Error(JSON.stringify(json.errors));
  return json.data.user.contributionsCollection.contributionCalendar;
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

function CalcStats(cal) {
  const days = cal.weeks.flatMap((w) => w.contributionDays);
  let longest = 0;
  let run = 0;
  for (const d of days) {
    run = d.contributionCount > 0 ? run + 1 : 0;
    longest = Math.max(longest, run);
  }
  let current = 0;
  for (let i = days.length - 1; i >= 0; i--) {
    if (days[i].contributionCount > 0) current++;
    else if (i === days.length - 1) continue;
    else break;
  }
  const peak = days.reduce((a, d) => (d.contributionCount > a.contributionCount ? d : a), days[0]);
  return { total: cal.totalContributions, longest, current, peak };
}

function FmtDate(iso) {
  const d = new Date(`${iso}T00:00:00Z`);
  return `${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()}`;
}

function RenderStars() {
  const rng = Mulberry32(1337);
  let out = "";
  for (let i = 0; i < 84; i++) {
    const x = (PLOT_X + rng() * PLOT_W).toFixed(1);
    const y = (14 + rng() * 170).toFixed(1);
    const r = (rng() * 1.1 + 0.4).toFixed(2);
    const dur = (rng() * 3 + 2).toFixed(1);
    const delay = (rng() * 4).toFixed(1);
    out += `<circle class="s" cx="${x}" cy="${y}" r="${r}" fill="#cfe8ff" style="animation-duration:${dur}s;animation-delay:${delay}s"/>`;
  }
  return out;
}

function RenderMoon() {
  return `<g>
    <circle cx="600" cy="84" r="40" fill="#f5ecd7" opacity="0.08"/>
    <circle cx="600" cy="84" r="24" fill="#f5ecd7" opacity="0.92"/>
    <circle cx="610" cy="76" r="21" fill="#0e0b30"/>
  </g>`;
}

function RenderShootingStar() {
  return `<g class="shoot">
    <line x1="0" y1="0" x2="70" y2="24" stroke="url(#tail)" stroke-width="1.6" stroke-linecap="round"/>
  </g>`;
}

function RenderBuilding(week, i, slot, bw, maxCount) {
  const count = week.contributionDays.reduce((a, d) => a + d.contributionCount, 0);
  const t = Math.pow(count / maxCount, 0.65);
  const h = count === 0 ? MIN_H : Math.max(MIN_H + 10, Math.round(t * MAX_H));
  const x = +(PLOT_X + i * slot + (slot - bw) / 2).toFixed(1);
  const y = HORIZON - h;
  const c = NEON[i % NEON.length];
  const rng = Mulberry32(i * 7919 + count * 131 + 7);
  const first = week.contributionDays[0].date;
  const last = week.contributionDays[week.contributionDays.length - 1].date;

  let windows = "";
  const litProb = 0.12 + 0.78 * t;
  for (let wy = y + 7; wy < HORIZON - 6; wy += 7) {
    for (const wx of [2.4, 6.6, 10.8]) {
      const isLit = rng() < litProb;
      let cls = isLit ? "wl" : "wd";
      let style = "";
      if (isLit && rng() < 0.08) {
        cls += " wf";
        style = ` style="animation-delay:${(rng() * 5).toFixed(1)}s"`;
      }
      windows += `<rect class="${cls}" x="${(x + wx).toFixed(1)}" y="${wy.toFixed(1)}" width="2.6" height="3.6"${style}/>`;
    }
  }

  let antenna = "";
  if (h > MAX_H * 0.7) {
    const ax = (x + bw / 2).toFixed(1);
    antenna = `<line x1="${ax}" y1="${y - 13}" x2="${ax}" y2="${y}" stroke="#3a3a5e" stroke-width="1.2"/>
      <circle class="beacon" cx="${ax}" cy="${y - 14}" r="1.8" fill="#ff3355" style="animation-delay:${(rng() * 2).toFixed(1)}s"/>`;
  }

  return `<g class="b" style="animation-delay:${i * 16}ms">
    <title>${first} → ${last} · ${count} commit${count === 1 ? "" : "s"}</title>
    ${antenna}
    <rect x="${x}" y="${y}" width="${bw}" height="${h}" fill="url(#bldg)"/>
    <rect x="${x}" y="${y}" width="1.4" height="${h}" fill="${c}" opacity="0.3"/>
    <rect x="${x}" y="${y - 2.4}" width="${bw}" height="2.4" fill="${c}" filter="url(#glow)"/>
    ${windows}
  </g>`;
}

function RenderCity(cal) {
  const weeks = cal.weeks;
  const slot = PLOT_W / weeks.length;
  const bw = Math.min(15, +(slot - 3.5).toFixed(1));
  const maxCount = Math.max(1, ...weeks.map((w) => w.contributionDays.reduce((a, d) => a + d.contributionCount, 0)));
  return `<g id="city">${weeks.map((w, i) => RenderBuilding(w, i, slot, bw, maxCount)).join("\n")}</g>`;
}

function RenderMonthTicks(cal) {
  const slot = PLOT_W / cal.weeks.length;
  let out = "";
  let prev = -1;
  cal.weeks.forEach((w, i) => {
    const m = new Date(`${w.contributionDays[0].date}T00:00:00Z`).getUTCMonth();
    if (m !== prev && i > 0 && i < cal.weeks.length - 2) {
      out += `<text class="tick" x="${(PLOT_X + i * slot).toFixed(1)}" y="${HORIZON + 17}">${MONTHS[m].toUpperCase()}</text>`;
    }
    prev = m;
  });
  return out;
}

function RenderStats(stats, updated) {
  const peakLabel = `${stats.peak.contributionCount}/day (${FmtDate(stats.peak.date)})`;
  const line = `LONGEST STREAK ${stats.longest}D   ·   CURRENT ${stats.current}D   ·   PEAK ${peakLabel}   ·   SYNCED ${updated}`;
  return `<text class="stats" x="${W / 2}" y="${H - 12}" text-anchor="middle">${line}</text>`;
}

function RenderSvg(cal, stats, updated) {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" aria-label="${LOGIN} commit skyline">
<defs>
  <linearGradient id="sky" x1="0" y1="0" x2="0" y2="1">
    <stop offset="0" stop-color="#050514"/>
    <stop offset="0.55" stop-color="#0e0b30"/>
    <stop offset="0.85" stop-color="#2a1157"/>
    <stop offset="1" stop-color="#45175f"/>
  </linearGradient>
  <linearGradient id="water" x1="0" y1="0" x2="0" y2="1">
    <stop offset="0" stop-color="#1b0d3a"/>
    <stop offset="1" stop-color="#04040f"/>
  </linearGradient>
  <linearGradient id="hz" x1="0" y1="0" x2="1" y2="0">
    <stop offset="0" stop-color="#00e5ff"/>
    <stop offset="0.5" stop-color="#ff3fd8"/>
    <stop offset="1" stop-color="#9d5cff"/>
  </linearGradient>
  <linearGradient id="bldg" x1="0" y1="0" x2="0" y2="1">
    <stop offset="0" stop-color="#12122e"/>
    <stop offset="1" stop-color="#0a0a20"/>
  </linearGradient>
  <linearGradient id="fadeG" x1="0" y1="0" x2="0" y2="1">
    <stop offset="0" stop-color="#fff" stop-opacity="0.85"/>
    <stop offset="1" stop-color="#fff" stop-opacity="0"/>
  </linearGradient>
  <linearGradient id="tail" x1="0" y1="0" x2="1" y2="0">
    <stop offset="0" stop-color="#fff" stop-opacity="0"/>
    <stop offset="1" stop-color="#cfe8ff"/>
  </linearGradient>
  <filter id="glow" x="-80%" y="-80%" width="260%" height="260%">
    <feGaussianBlur stdDeviation="2.4" result="b"/>
    <feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge>
  </filter>
  <filter id="blur1"><feGaussianBlur stdDeviation="1.4"/></filter>
  <mask id="fade">
    <rect x="0" y="${HORIZON}" width="${W}" height="${H - HORIZON}" fill="url(#fadeG)"/>
  </mask>
</defs>
<style>
  text{font-family:'JetBrains Mono','Fira Code',ui-monospace,monospace}
  .title{font-size:30px;font-weight:700;letter-spacing:8px;fill:#00e5ff;animation:fk 7s infinite}
  .sub{font-size:11px;letter-spacing:3px;fill:#8888c8}
  .total{font-size:34px;font-weight:700;letter-spacing:2px;fill:#ff3fd8}
  .stats{font-size:12px;letter-spacing:2px;fill:#6fb9d4}
  .tick{font-size:9px;letter-spacing:1px;fill:#565694}
  .wl{fill:#ffd98c}
  .wd{fill:#151533}
  .wf{animation:wf 4.2s infinite}
  .s{animation:tw 3s ease-in-out infinite both}
  .b{transform-box:fill-box;transform-origin:center bottom;animation:rise .9s cubic-bezier(.22,1,.36,1) both}
  .beacon{animation:bk 2.4s infinite}
  .ref{animation:bob 8s ease-in-out infinite}
  .shoot{animation:sh 14s linear infinite}
  @keyframes rise{from{transform:scaleY(0)}to{transform:scaleY(1)}}
  @keyframes tw{0%,100%{opacity:.12}50%{opacity:.9}}
  @keyframes wf{0%,64%,100%{opacity:1}70%{opacity:.12}76%{opacity:1}90%{opacity:.35}94%{opacity:1}}
  @keyframes bk{0%,68%,100%{opacity:.15}78%,88%{opacity:1}}
  @keyframes fk{0%,100%{opacity:1}3%{opacity:.55}5%{opacity:1}54%{opacity:1}55%{opacity:.5}57%{opacity:1}}
  @keyframes bob{0%,100%{transform:translateY(0)}50%{transform:translateY(3px)}}
  @keyframes sh{0%,88%{transform:translate(180px,30px);opacity:0}90%{opacity:1}100%{transform:translate(560px,150px);opacity:0}}
</style>
<rect width="${W}" height="${HORIZON}" fill="url(#sky)"/>
<rect y="${HORIZON}" width="${W}" height="${H - HORIZON}" fill="url(#water)"/>
${RenderStars()}
${RenderMoon()}
${RenderShootingStar()}
<g class="ref" mask="url(#fade)" opacity="0.35" filter="url(#blur1)">
  <use href="#city" transform="translate(0 ${HORIZON * 2}) scale(1 -1)"/>
</g>
${RenderCity(cal)}
<rect y="${HORIZON - 1}" width="${W}" height="2" fill="url(#hz)" filter="url(#glow)" opacity="0.9"/>
${RenderMonthTicks(cal)}
<text class="title" x="42" y="58" filter="url(#glow)">${LOGIN.toUpperCase()}</text>
<text class="sub" x="42" y="80">ONE YEAR OF COMMITS · REBUILT NIGHTLY</text>
<text class="total" x="${W - 42}" y="56" text-anchor="end" filter="url(#glow)">${stats.total.toLocaleString("en-US")}</text>
<text class="sub" x="${W - 42}" y="76" text-anchor="end">CONTRIBUTIONS · LAST 365 DAYS</text>
${RenderStats(stats, updated)}
</svg>`;
}

const cal = await FetchCalendar();
const stats = CalcStats(cal);
const updated = new Date().toISOString().slice(0, 10);
const svg = RenderSvg(cal, stats, updated);
mkdirSync("dist", { recursive: true });
writeFileSync("dist/skyline.svg", svg);
console.log(`skyline.svg → ${stats.total} contributions, ${cal.weeks.length} weeks, ${(svg.length / 1024).toFixed(1)} KB`);
