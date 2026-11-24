/**
 * HTML pages in the XKDR design language: warm off-white ground (#f2f1f0), black type and rules,
 * coral (#f57d6a) accents, Montserrat for headings and labels, Merriweather for reading text,
 * square corners, 2 px black borders. See https://www.xkdr.org.
 */
import type { Env } from "./env";
import { isInstantMode, isRequestMode } from "./env";
import { LOGO_FULL, LOGO_MARK } from "./brand";
import { escapeHtml } from "./http";

export const GITHUB_URL = "https://github.com/xKDR/Air-Quality-Database";
export const COLAB_URL = "https://colab.research.google.com/github/xKDR/Air-Quality-Database/blob/main/india_air_quality_quickstart.ipynb";

export interface Stats {
  rows: number;
  stations: number;
  parameters: number;
  months: number;
  firstMonth: string; // YYYY-MM
  lastMonth: string;
  exportedAt: string; // ISO
}

const FONTS = `<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Montserrat:wght@700;800;900&family=Merriweather:ital,wght@0,300;0,400;0,700;1,300&display=swap" rel="stylesheet">`;

const CSS = `
:root{--coral:#f57d6a;--ink:#000;--paper:#f2f1f0;--grey:#4b4b4b;--soft:#d6d6d6;--white:#fff;
  --head:"Montserrat",system-ui,sans-serif;--body:"Merriweather",Georgia,serif;--mono:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace}
*{box-sizing:border-box}html{background:var(--paper);color-scheme:light}
body{margin:0;background:var(--paper);color:var(--ink);font-family:var(--body);font-size:15px;line-height:1.75;-webkit-font-smoothing:antialiased;overflow-x:hidden}
.wrap{max-width:1080px;margin:0 auto;padding:0 32px}
a{color:var(--ink);text-decoration:none;border-bottom:1px solid var(--coral);transition:color .15s}a:hover{color:var(--coral)}
.plain,.plain:hover{border:0}
/* header */
.top{display:flex;align-items:center;justify-content:space-between;gap:24px;padding:30px 0 26px;flex-wrap:wrap}
.brand{display:flex;align-items:center;gap:18px;border:0}.brand svg{height:42px;width:auto;display:block}
.brand .name{font-family:var(--head);font-weight:800;font-size:12px;letter-spacing:.2em;text-transform:uppercase;line-height:1.3}
.brand .name small{display:block;font-weight:700;font-size:9px;letter-spacing:.24em;color:var(--grey)}
nav{display:flex;align-items:center;gap:26px;flex-wrap:wrap}
nav a{font-family:var(--head);font-weight:800;font-size:11px;letter-spacing:.18em;text-transform:uppercase;border:0;padding-bottom:4px;border-bottom:2px solid transparent}
nav a:hover{color:var(--ink);border-color:var(--coral)}
/* buttons */
.btn{display:inline-block;background:var(--ink);color:var(--paper);font-family:var(--head);font-weight:900;font-size:11px;letter-spacing:.2em;text-transform:uppercase;padding:15px 34px;border:2px solid var(--ink);cursor:pointer;transition:all .15s;line-height:1.2}
.btn:hover{background:var(--coral);border-color:var(--coral);color:var(--ink)}
.btn.ghost{background:transparent;color:var(--ink)}.btn.ghost:hover{background:transparent;color:var(--ink);border-color:var(--coral)}
.btn.small{padding:10px 18px;font-size:10px}
button.btn{font-family:var(--head)}
/* type */
h1{font-family:var(--head);font-weight:800;font-size:clamp(40px,6.2vw,66px);line-height:1.02;letter-spacing:-.015em;color:var(--coral);margin:0 0 26px}
h2{font-family:var(--head);font-weight:800;font-size:clamp(28px,3.6vw,38px);line-height:1.12;color:var(--coral);margin:0 0 18px}
h3{font-family:var(--head);font-weight:800;font-size:19px;line-height:1.3;margin:6px 0 12px}
p{margin:0 0 14px}.lede{font-size:19px;line-height:1.65;font-weight:300;max-width:620px}
.eyebrow{font-family:var(--head);font-weight:800;font-size:11px;letter-spacing:.22em;text-transform:uppercase;margin:0 0 20px;display:flex;align-items:center;gap:12px}
.eyebrow::before{content:"";width:10px;height:10px;background:var(--coral);flex:none}
.grey{color:var(--grey)}.small{font-size:13px}
.pixels{height:8px;margin:0;background:repeating-linear-gradient(90deg,var(--coral) 0 8px,transparent 8px 16px)}
/* layout */
.hero{display:grid;grid-template-columns:1.35fr 1fr;gap:56px;align-items:end;padding:56px 0 64px}
.cta{display:flex;gap:18px;align-items:center;flex-wrap:wrap;margin-top:30px}
section{padding:56px 0;border-top:2px solid var(--ink)}section.first{border-top:0}
.cols{display:grid;grid-template-columns:1fr 1fr;gap:28px}.cols-3{display:grid;grid-template-columns:1fr 1fr 1fr;gap:28px}
.hero>*,.cols>*,.cols-3>*,.card{min-width:0}pre{max-width:100%}
.card{border:2px solid var(--ink);padding:28px 28px 22px;position:relative}
.card.coral{border-color:var(--coral)}
.tag{position:absolute;top:-2px;right:-2px;background:var(--coral);color:var(--ink);font-family:var(--head);font-weight:800;font-size:10px;letter-spacing:.18em;text-transform:uppercase;padding:6px 12px}
.stats{border:2px solid var(--ink);padding:10px 28px 14px}
.stat{display:flex;justify-content:space-between;align-items:baseline;gap:16px;padding:13px 0;border-bottom:1px solid var(--soft)}.stat:last-child{border:0}
.stat b{font-family:var(--head);font-weight:800;font-size:26px;letter-spacing:-.01em}.stat b.sm{font-size:19px}
.stat span{font-family:var(--head);font-weight:700;font-size:10px;letter-spacing:.16em;text-transform:uppercase;color:var(--grey);text-align:right}
.steps{counter-reset:s;list-style:none;margin:0;padding:0}.steps li{counter-increment:s;display:grid;grid-template-columns:44px 1fr;gap:14px;padding:14px 0;border-bottom:1px solid var(--soft)}
.steps li::before{content:counter(s,decimal-leading-zero);font-family:var(--head);font-weight:800;color:var(--coral);font-size:22px;line-height:1.1}
/* tables */
table{width:100%;border-collapse:collapse;font-size:14px;margin:8px 0 18px}
th{font-family:var(--head);font-weight:800;font-size:10px;letter-spacing:.16em;text-transform:uppercase;text-align:left;padding:10px 10px 10px 0;border-bottom:2px solid var(--ink);white-space:nowrap}
td{padding:12px 10px 12px 0;border-bottom:1px solid var(--soft);vertical-align:top}td:first-child{white-space:nowrap}
.tablewrap{overflow-x:auto}
/* code */
code{font-family:var(--mono);font-size:.88em;background:var(--white);border:1px solid var(--soft);padding:1px 6px;white-space:nowrap}
pre{background:var(--ink);color:var(--paper);padding:22px 24px;overflow-x:auto;font-family:var(--mono);font-size:13px;line-height:1.65;margin:0;tab-size:2}
pre code{background:none;border:0;padding:0;white-space:pre;font-size:inherit}
.code{position:relative;margin:18px 0 6px}.code pre{padding-top:34px}.code .lbl{position:absolute;top:0;right:0;background:var(--coral);color:var(--ink);font-family:var(--head);font-weight:800;font-size:10px;letter-spacing:.18em;text-transform:uppercase;padding:5px 12px}
.k{color:var(--coral)}.c{color:#9a9a9a}
/* forms */
label{display:block;font-family:var(--head);font-weight:800;font-size:10px;letter-spacing:.18em;text-transform:uppercase;margin:20px 0 8px}
label:first-child{margin-top:0}label .opt{color:var(--grey);font-weight:700;letter-spacing:.1em;text-transform:none;font-size:10px}
input[type=text],input[type=email],textarea{width:100%;background:var(--white);border:2px solid var(--ink);padding:12px 14px;font-family:var(--body);font-size:15px;color:var(--ink);outline:0;transition:border-color .15s}
input:focus,textarea:focus{border-color:var(--coral)}textarea{min-height:92px;resize:vertical}
.check{display:flex;gap:12px;align-items:flex-start;font-family:var(--body);font-size:13.5px;line-height:1.55;margin:16px 0 0;text-transform:none;letter-spacing:0;font-weight:400}
.check input{margin:5px 0 0;accent-color:var(--coral);width:16px;height:16px;flex:none}
.alert{border:2px solid var(--coral);padding:14px 18px;margin:0 0 22px;font-family:var(--head);font-weight:700;font-size:13px}
/* key reveal */
.keybox{border:2px solid var(--coral);background:var(--white);padding:18px 20px;display:flex;gap:16px;align-items:center;justify-content:space-between;flex-wrap:wrap;margin:18px 0}
.keybox code{font-size:15px;border:0;background:none;padding:0;word-break:break-all;white-space:normal}
/* footer */
footer{border-top:2px solid var(--ink);margin-top:72px;padding:44px 0 64px}
.foot{display:flex;justify-content:space-between;gap:40px;flex-wrap:wrap;align-items:flex-start}
.foot svg{height:46px;width:auto;display:block;margin-bottom:16px}
.foot p{font-size:13px;color:var(--grey);max-width:460px;margin:0 0 8px}
.foot nav{flex-direction:column;align-items:flex-start;gap:12px}
@media(max-width:860px){.hero,.cols,.cols-3{grid-template-columns:1fr;gap:28px}.hero{padding:32px 0 44px}.wrap{padding:0 20px}nav{gap:18px}.hide-sm{display:none}
  .top{padding:22px 0 18px}.brand svg{height:36px}section{padding:44px 0}.foot nav{flex-direction:row}}
`;

function head(title: string, extra = ""): string {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${escapeHtml(title)}</title><meta name="description" content="Hourly air quality readings for India from CPCB CAAQM stations and US Embassy monitors, as an API and bulk Parquet files. By XKDR Forum.">
<link rel="icon" href="data:image/svg+xml,${encodeURIComponent(LOGO_MARK)}">${FONTS}<style>${CSS}</style>${extra}</head><body>`;
}

function header(env: Env, current: "home" | "signup" | "other"): string {
  const link = (href: string, text: string, cls = "") => `<a href="${href}" class="${cls}">${text}</a>`;
  return `<div class="wrap"><header class="top">
  <a class="brand plain" href="/">${LOGO_MARK}<span class="name">India Air Quality API<small>XKDR Forum</small></span></a>
  <nav>${link("/#docs", "Docs", "hide-sm")}${link("/demo", "Demo", "hide-sm")}${link(COLAB_URL, "Notebook", "hide-sm")}${link("/#bulk", "Bulk data", "hide-sm")}${env.CONTACT_EMAIL ? link("mailto:" + escapeHtml(env.CONTACT_EMAIL), "Contact", "hide-sm") : ""}${current === "signup" ? "" : link("/signup", isRequestMode(env) ? "Request a key" : "Get a key", "btn small")}</nav>
</header></div>`;
}

function footer(env: Env): string {
  return `<footer><div class="wrap foot">
  <div>${LOGO_FULL}<p>Built and maintained by <a href="https://www.xkdr.org" rel="noopener">XKDR Forum</a>, Mumbai. Data from the Central Pollution Control Board's CAAQM network and the US Department of State via AirNow.</p>
  ${env.CONTACT_EMAIL ? `<p>Questions, corrections, higher limits: <a href="mailto:${escapeHtml(env.CONTACT_EMAIL)}">${escapeHtml(env.CONTACT_EMAIL)}</a></p>` : ""}</div>
  <nav><a href="/#docs">Docs</a><a href="/demo">Demo</a><a href="${COLAB_URL}">Colab notebook</a><a href="${GITHUB_URL}">GitHub</a><a href="/#bulk">Bulk data</a><a href="/#limits">Keys</a><a href="/#data">About the data</a><a href="/#cite">Cite</a><a href="/signup">${isRequestMode(env) ? "Request a key" : "Get a key"}</a></nav>
</div></footer></body></html>`;
}

const fmtM = (n: number) => (n >= 1e9 ? (n / 1e9).toFixed(2) + " B" : n >= 1e6 ? (n / 1e6).toFixed(1) + " M" : n >= 1e3 ? (n / 1e3).toFixed(0) + " K" : String(n));
const fmtMonth = (ym: string) => {
  const [y, m] = ym.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, 1)).toLocaleString("en-GB", { month: "short", year: "numeric", timeZone: "UTC" });
};
const fmtDate = (iso: string) => new Date(iso).toLocaleString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });

// ---------------------------------------------------------------------------
// Landing page
// ---------------------------------------------------------------------------
export function requestMailto(env: Env): string {
  const subject = "India Air Quality API: key request";
  const body = ["Hello XKDR,", "", "I would like an API key for the India Air Quality API.", "",
    "Name:", "Organisation:", "How I plan to use the data:", "", "Thank you."].join("\n");
  return `mailto:${env.CONTACT_EMAIL}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
}

export function landingPage(env: Env, stats: Stats | null): string {
  const base = env.PUBLIC_URL;
  const mailto = requestMailto(env);
  const demo = env.DEMO_API_KEY || "aqi_…";
  const statsCard = stats
    ? `<div class="stats">
  <div class="stat"><b>${fmtM(stats.rows)}</b><span>hourly readings</span></div>
  <div class="stat"><b>${stats.stations}</b><span>monitoring stations</span></div>
  <div class="stat"><b>${stats.parameters}</b><span>pollutants</span></div>
  <div class="stat"><b class="sm">${fmtMonth(stats.firstMonth)} – ${fmtMonth(stats.lastMonth)}</b><span>coverage</span></div>
  <div class="stat"><b class="sm">${fmtDate(stats.exportedAt)}</b><span>last published</span></div>
</div>`
    : `<div class="stats"><div class="stat"><b>CPCB + US Embassy</b><span>sources</span></div><div class="stat"><b>2009 onwards</b><span>coverage</span></div><div class="stat"><b>Hourly</b><span>resolution</span></div></div>`;

  return head("India Air Quality API · XKDR Forum") + header(env, "home") + `
<main class="wrap">
<div class="hero">
  <div>
    <p class="eyebrow">XKDR Forum · Open data</p>
    <h1>Hourly air quality for India, since 2009.</h1>
    <p class="lede">Readings from every station in CPCB's continuous monitoring network and the five US Embassy monitors, cleaned into one table. Query a slice through the API, or take the Parquet files whole.</p>
    <div class="cta"><a class="btn plain" href="/signup">${isRequestMode(env) ? "Request an API key" : "Get an API key"}</a><a class="btn ghost plain" href="#docs">Read the docs</a><a class="btn ghost plain" href="/demo">See the demo</a><a class="btn ghost plain" href="${COLAB_URL}">Open in Colab</a></div>
    ${env.DEMO_API_KEY ? `<p class="small grey" style="margin-top:22px">Try it right now with the demo key <code>${escapeHtml(demo)}</code>. The API examples on this page use it. It is capped at 10,000 rows per query and can only read the 2024 bulk files; <a href="/signup">a key of your own</a> has no limits.</p>` : ""}
  </div>
  ${statsCard}
</div>
<div class="pixels"></div>

<section class="first" id="ways">
  <p class="eyebrow">Two ways in</p>
  <div class="cols">
    <div class="card"><span class="tag">Query API</span>
      <h3>Ask for exactly the slice you need</h3>
      <p>Filter by station, city, state, pollutant and dates. Aggregate to hourly, daily or monthly means. Get JSON, CSV or Parquet back.</p>
      <div class="code"><span class="lbl">curl</span><pre><code>curl -H "Authorization: Bearer <span class="k">${escapeHtml(demo)}</span>" \\
  "${escapeHtml(base)}/v1/measurements?city=Delhi&amp;parameter=PM2.5&amp;start=2024-11-01&amp;end=2024-11-30&amp;agg=daily&amp;format=csv"</code></pre></div>
    </div>
    <div class="card"><span class="tag">Bulk Parquet</span>
      <h3>Or take the whole thing</h3>
      <p>One sorted Parquet file per month, under half a gigabyte in total. Download them, or point DuckDB at the URLs and query in place.</p>
      <div class="code"><span class="lbl">DuckDB</span><pre><code>CREATE SECRET aqi (TYPE http, BEARER_TOKEN '<span class="k">aqi_…</span>');
SELECT station_id, avg(value) FROM read_parquet(
  '${escapeHtml(base)}/v1/files/v1/measurements/year=2024/month=11/data.parquet')
WHERE parameter_name = 'PM2.5' GROUP BY 1;</code></pre></div>
    </div>
  </div>
</section>

<section id="docs">
  <p class="eyebrow">Reference</p>
  <h2>Endpoints</h2>
  <p>Every request carries your key as a bearer token. All endpoints accept <code>format=json|csv|parquet</code>. Interactive documentation with a try-it-out console lives at <a href="/v1/docs">/v1/docs</a>.</p>
  <div class="tablewrap"><table>
    <tr><th>Endpoint</th><th>What you get</th></tr>
    <tr><td><code>GET /v1/meta</code></td><td>What is published: export time, months covered, row counts, schema, your tier and row cap.</td></tr>
    <tr><td><code>GET /v1/stations</code></td><td>Stations with coordinates, first and last reading, and the pollutants each reports. Filters: <code>source</code>, <code>state</code>, <code>city</code>, <code>q</code>.</td></tr>
    <tr><td><code>GET /v1/parameters</code></td><td>Pollutants, units, station counts.</td></tr>
    <tr><td><code>GET /v1/measurements</code></td><td>The time series. Parameters below.</td></tr>
    <tr><td><code>GET /v1/files</code></td><td>List of bulk files with sizes and row counts.</td></tr>
    <tr><td><code>GET /v1/files/&lt;key&gt;</code></td><td>One bulk file. Honours <code>Range</code>, so query engines can read it in place.</td></tr>
  </table></div>

  <h3>Measurements parameters</h3>
  <div class="tablewrap"><table>
    <tr><th>Name</th><th>Meaning</th></tr>
    <tr><td><code>station</code></td><td>A <code>station_id</code> such as <code>site_103</code> or <code>DS1010001</code>. Repeat for several.</td></tr>
    <tr><td><code>parameter</code></td><td><code>PM2.5</code>, <code>PM10</code>, <code>NO2</code>, <code>SO2</code>, <code>CO</code>, <code>Ozone</code>, <code>NH3</code>, <code>Benzene</code>, … Repeat for several.</td></tr>
    <tr><td><code>city</code>, <code>state</code></td><td>Case-insensitive exact match, e.g. <code>city=Delhi</code>.</td></tr>
    <tr><td><code>source</code></td><td><code>cpcb_caaqm</code> or <code>us_embassy</code>.</td></tr>
    <tr><td><code>start</code>, <code>end</code></td><td><code>YYYY-MM-DD</code>, inclusive, Indian Standard Time. Default: the last 30 days.</td></tr>
    <tr><td><code>agg</code></td><td><code>raw</code> (default), <code>hourly</code>, <code>daily</code>, <code>monthly</code>. Aggregates return mean, min, max and count per period.</td></tr>
    <tr><td><code>limit</code></td><td>Optional row cap for this call.</td></tr>
  </table></div>
  <p class="small grey">Responses carry <code>X-Row-Count</code> and <code>X-Truncated</code> headers; the latter is only ever true when you passed <code>limit</code>.</p>
</section>

<section id="examples">
  <p class="eyebrow">Examples</p>
  <h2>Start in a notebook</h2>
  <div class="cols" style="margin-bottom:34px">
    <div class="card coral"><span class="tag">Google Colab</span>
      <h3>Quickstart notebook</h3>
      <p>Runs top to bottom in about a minute with the demo key: coverage, a station map, one year of data pulled into the runtime, Delhi's November smog hour by hour, five cities through the year, the daily cycle, and maps of PM2.5 by station.</p>
      <div class="cta"><a class="btn plain" href="${COLAB_URL}">Open in Colab</a><a class="btn ghost plain" href="${GITHUB_URL}">Source on GitHub</a></div>
    </div>
    <div>
      <h3>Everything in one repository</h3>
      <p><a href="${GITHUB_URL}">xKDR/Air-Quality-Database</a> holds the notebook, this site and gateway, the query service, the Parquet exporter and the operator docs. Issues and pull requests welcome.</p>
    </div>
  </div>
  <h3 style="margin-top:8px">Three ways to ask</h3>
  <div class="code"><span class="lbl">Python</span><pre><code>import pandas as pd, requests

r = requests.get("${escapeHtml(base)}/v1/measurements",
                 headers={"Authorization": "Bearer <span class="k">${escapeHtml(demo)}</span>"},
                 params={"station": "site_103", "parameter": ["PM2.5", "PM10"],
                         "start": "2024-01-01", "end": "2024-12-31", "agg": "daily", "format": "csv"})
df = pd.read_csv(io.StringIO(r.text), parse_dates=["period_start"])</code></pre></div>
  <div class="code"><span class="lbl">R</span><pre><code>library(httr2)
resp &lt;- request("${escapeHtml(base)}/v1/measurements") |&gt;
  req_headers(Authorization = "Bearer <span class="k">${escapeHtml(demo)}</span>") |&gt;
  req_url_query(city = "Mumbai", parameter = "PM2.5", start = "2024-11-01", end = "2024-11-30", agg = "daily", format = "csv") |&gt;
  req_perform()
df &lt;- read.csv(text = resp_body_string(resp))</code></pre></div>
  <div class="code"><span class="lbl">DuckDB, a whole year in place</span><pre><code>INSTALL httpfs; LOAD httpfs;
CREATE SECRET aqi (TYPE http, BEARER_TOKEN '<span class="k">${escapeHtml(demo)}</span>');   <span class="c">-- the demo key can read the 2024 files</span>
SELECT city_name, month, round(avg(value), 1) AS pm25
FROM read_parquet(
  list_transform(range(1, 13), m -> format('${escapeHtml(base)}/v1/files/v1/measurements/year=2024/month={:02d}/data.parquet', m)),
  hive_partitioning = true)
WHERE parameter_name = 'PM2.5' AND city_name = 'Delhi' GROUP BY ALL ORDER BY ALL;
<span class="c">-- Wildcards don't work over HTTPS, so list the month files explicitly as above (or download them first).</span></code></pre></div>
</section>

<section id="bulk">
  <p class="eyebrow">Bulk data</p>
  <h2>The files</h2>
  <div class="cols">
    <div>
      <p><code>GET /v1/files</code> lists everything. Keys look like <code>v1/measurements/year=2024/month=03/data.parquet</code>, plus <code>v1/stations.parquet</code> and <code>v1/parameters.parquet</code>.</p>
      <p>Each month file is sorted by station, pollutant and time, with one-million-row row groups, so engines that read Parquet statistics skip most of a file when you filter on a station. Bulk files have no row limit.</p>
    </div>
    <div class="code"><span class="lbl">Mirror everything</span><pre><code>B=${escapeHtml(base)}; K=<span class="k">${escapeHtml(demo)}</span>
for k in $(curl -s -H "Authorization: Bearer $K" $B/v1/files | jq -r '.files[].key'); do
  mkdir -p "$(dirname "$k")"
  curl -s -H "Authorization: Bearer $K" -o "$k" "$B/v1/files/$k"
done</code></pre></div>
  </div>
</section>

<section id="limits">
  <p class="eyebrow">Keys</p>
  <h2>${isInstantMode(env) ? "Free keys, in about a minute." : "Free, full access. Just ask."}</h2>
  <div class="cols">
    <div>
      ${isInstantMode(env) ? `<ol class="steps">
        <li><div><b>Fill in <a href="/signup">the short form</a>.</b> Your name and email; your organisation and plans are optional.</div></li>
        <li><div><b>Pass Cloudflare's human check.</b> It usually ticks itself.</div></li>
        <li><div><b>Copy your key.</b> It is shown once. Keep it private; if you lose it, sign up again for a new one.</div></li>
      </ol>
      <div class="cta"><a class="btn plain" href="/signup">Get an API key</a></div>` : `<ol class="steps">
        <li><div><b>Email <a href="${mailto}">${escapeHtml(env.CONTACT_EMAIL)}</a>.</b> Tell us your name, which organisation you are with, and how you plan to use the data.</div></li>
        <li><div><b>We reply with your key</b>, usually within a working day.</div></li>
        <li><div><b>Keep it private.</b> If it leaks or you lose it, email us and we'll rotate it.</div></li>
      </ol>
      <div class="cta"><a class="btn plain" href="/signup">Request a key</a></div>`}
    </div>
    <div>
      <h3>No rate limits, no row caps</h3>
      <p>Every key can do everything the API offers, at whatever pace you need, and reads every bulk file. Two practical notes: JSON is verbose, so ask for <code>format=csv</code> or <code>parquet</code> when you expect more than a few hundred thousand rows, and single queries time out after 90 seconds, so pull whole years from the <a href="#bulk">bulk files</a> instead.</p>
    </div>
  </div>
</section>

<section id="data">
  <p class="eyebrow">About the data</p>
  <h2>What you should know before you use it</h2>
  <div class="cols-3">
    <div><h3>Time</h3><p><code>collected_at</code> is a naive timestamp. CPCB readings are Indian Standard Time, on the hour. US embassy readings are UTC, stamped at half past (AirNow's convention): add 5:30 before comparing them with CPCB. Date filters and daily/monthly aggregates apply to the stored timestamps as they are.</p></div>
    <div><h3>Values</h3><p>Published as received from the source networks: no gap filling, no outlier removal, no calibration. Units are harmonised in spelling only (µg/m³, mg/m³, ppb). Weather series that are one constant value for a whole station-year (CPCB fills missing sensors with 0) are left out.</p></div>
    <div><h3>Stations</h3><p><code>station_id</code> is CPCB's site number (<code>site_103</code>) or the embassy id (<code>DS1010001</code>). A few dozen decommissioned stations are missing from CPCB's current list and carry no coordinates.</p></div>
  </div>
  <p style="margin-top:22px"><b>Licence and attribution.</b> The compilation is released under <a href="https://creativecommons.org/licenses/by/4.0/">Creative Commons Attribution 4.0</a>: use it for anything, including commercial work, and credit <i>India Air Quality Database, XKDR Forum</i> together with the sources, the Central Pollution Control Board's Continuous Ambient Air Quality Monitoring network and the US Department of State via AirNow. If you build a product on it, we would appreciate hearing about it. <a href="#cite">How to cite it</a>.</p>
  <p><b>No warranty.</b> The data is provided as is, without warranty of any kind. It is published as received from the monitoring networks, which themselves label readings preliminary and not fully validated, and it has not been validated by XKDR for regulatory, legal or health decisions. Use it at your own risk and check against the source for anything that matters.</p>
</section>

<section id="cite">
  <p class="eyebrow">Cite</p>
  <h2>How to cite the data</h2>
  <div class="cols">
    <div>
      <p>If you use the data in a paper, report, story or product, cite the database and credit its two sources.</p>
      <div class="code"><span class="lbl">Citation</span><pre style="white-space:pre-wrap"><code style="white-space:pre-wrap">XKDR Forum (2026). India Air Quality Database. ${escapeHtml(base)}</code></pre></div>
      <p class="small grey" style="margin-top:14px"><b>Sources:</b> Central Pollution Control Board (CPCB), Continuous Ambient Air Quality Monitoring network; US Department of State air quality monitors, via AirNow.</p>
    </div>
    <div>
      <div class="code"><span class="lbl">BibTeX</span><pre><code>@misc{xkdr_aqi_2026,
  author = {{XKDR Forum}},
  title  = {India Air Quality Database},
  year   = {2026},
  url    = {${escapeHtml(base)}},
  note   = {Hourly readings, CPCB CAAQM
            and US Embassy monitors}
}</code></pre></div>
    </div>
  </div>
</section>
</main>` + footer(env);
}

// ---------------------------------------------------------------------------
// Signup flow
// ---------------------------------------------------------------------------
/** Plain-language limits for a tier, matching wrangler.toml rate limits and api/config.py row caps. */
export function tierLimits(tier: string): string {
  switch (tier) {
    case "full": return "no rate limit and no row cap";
    case "research": return "600 requests a minute and 5 million rows a query";
    case "dashboard": return "120 requests a minute and 100,000 rows a query";
    default: return "60 requests a minute and 100,000 rows a query";
  }
}

export function signupPage(env: Env, opts: { error?: string; values?: Record<string, string> } = {}): string {
  const v = opts.values ?? {};
  const instant = isInstantMode(env);
  const val = (k: string) => escapeHtml(v[k] ?? "");
  const turnstile = env.TURNSTILE_SITE_KEY
    ? `<div class="cf-turnstile" data-sitekey="${escapeHtml(env.TURNSTILE_SITE_KEY)}" data-theme="light" data-size="flexible" data-action="signup" style="margin-top:22px"></div>`
    : "";
  const extra = env.TURNSTILE_SITE_KEY ? `<script src="https://challenges.cloudflare.com/turnstile/v0/api.js" async defer></script>` : "";
  return head("Get an API key · India Air Quality API", extra) + header(env, "signup") + `
<main class="wrap">
<div class="hero" style="align-items:start;padding-bottom:40px">
  <div>
    <p class="eyebrow">Sign up</p>
    <h1 style="font-size:clamp(36px,5vw,54px)">Get an API key.</h1>
    <p class="lede">${instant
      ? "Free and instant. Fill in the form, pass Cloudflare's quick human check, and your key appears on the next page."
      : "Free, instant, and yours to keep. We email you a confirmation link; your key appears when you click it."}</p>
    <ol class="steps" style="margin-top:26px">
      <li><div><b>Tell us who you are.</b> An email and a name are all we need.</div></li>
      ${instant
        ? `<li><div><b>Show you're human.</b> Cloudflare's check usually passes on its own; sometimes it asks for one click.</div></li>`
        : `<li><div><b>Confirm your email.</b> The link works once and expires in 30 minutes.</div></li>`}
      <li><div><b>Start querying.</b> Your key has no rate limit and no row cap, and reads every bulk file.</div></li>
    </ol>
  </div>
  <form method="post" action="/signup" class="card" novalidate>
    ${opts.error ? `<div class="alert">${escapeHtml(opts.error)}</div>` : ""}
    <label for="email">Email</label>
    <input type="email" id="email" name="email" required autocomplete="email" value="${val("email")}" placeholder="you@example.org">
    <label for="name">Name</label>
    <input type="text" id="name" name="name" required maxlength="120" autocomplete="name" value="${val("name")}">
    <label for="affiliation">Affiliation <span class="opt">optional</span></label>
    <input type="text" id="affiliation" name="affiliation" maxlength="200" value="${val("affiliation")}" placeholder="University, company, newsroom, just curious">
    <label for="purpose">What will you use the data for? <span class="opt">optional</span></label>
    <textarea id="purpose" name="purpose" maxlength="1000">${val("purpose")}</textarea>
    <label class="check"><input type="checkbox" name="accept_terms" value="1" required> I will credit the data sources (CPCB and the US Department of State) and XKDR Forum in any publication.</label>
    ${turnstile}
    <button type="submit" class="btn" style="margin-top:24px;width:100%">${instant ? "Get my API key" : "Send confirmation email"}</button>
  </form>
</div>
</main>` + footer(env);
}

export function checkEmailPage(env: Env, email: string, devLink?: string): string {
  return head("Check your inbox · India Air Quality API") + header(env, "other") + `
<main class="wrap">
<div class="hero" style="align-items:start">
  <div>
    <p class="eyebrow">One more step</p>
    <h1 style="font-size:clamp(36px,5vw,54px)">Check your inbox.</h1>
    <p class="lede">If <b>${escapeHtml(email)}</b> is a real address, a confirmation link is on its way. It works once and expires in 30 minutes.</p>
    <p class="grey small" style="margin-top:18px">Nothing after a few minutes? Look in spam, then <a href="/signup">try again</a>.</p>
    ${devLink ? `<div class="alert" style="margin-top:24px">DEV MODE · <a href="${escapeHtml(devLink)}">${escapeHtml(devLink)}</a></div>` : ""}
  </div>
  <div class="card"><span class="tag">Meanwhile</span><h3>Warm up</h3><p>Skim the <a href="/#docs">endpoint reference</a> or the <a href="/#examples">examples</a>. Your first call will be <code>GET /v1/meta</code>, which tells you what's published and what your key can do.</p></div>
</div>
</main>` + footer(env);
}

export function keyPage(env: Env, key: string, tier: string, rotated: boolean): string {
  const base = env.PUBLIC_URL;
  const script = `<script>
function cp(){var t=document.getElementById('key').textContent;navigator.clipboard&&navigator.clipboard.writeText(t).then(function(){var b=document.getElementById('cpb');b.textContent='Copied';setTimeout(function(){b.textContent='Copy'},1800)})}
</script>`;
  return head("Your API key · India Air Quality API", script) + header(env, "other") + `
<main class="wrap">
<div class="hero" style="align-items:start">
  <div>
    <p class="eyebrow">Done</p>
    <h1 style="font-size:clamp(36px,5vw,54px)">Here's your key.</h1>
    <p class="lede">Copy it now. <b>It will not be shown again.</b> ${isInstantMode(env) ? "If you lose it, sign up again for a new one." : "If you lose it, sign up again with the same email and a new key replaces this one."}</p>
    <div class="keybox"><code id="key">${escapeHtml(key)}</code><button class="btn small" id="cpb" onclick="cp()" type="button">Copy</button></div>
    <p class="small grey">Tier: <b>${escapeHtml(tier)}</b> (${tierLimits(tier)})${rotated ? " · your previous key has been revoked" : ""}. Send it as <code>Authorization: Bearer …</code> on every request.</p>
  </div>
  <div>
    <div class="code"><span class="lbl">Try it</span><pre><code>curl -H "Authorization: Bearer <span class="k">${escapeHtml(key.slice(0, 12))}…</span>" \\
  "${escapeHtml(base)}/v1/meta"</code></pre></div>
    <div class="code"><span class="lbl">Then</span><pre><code>curl -H "Authorization: Bearer <span class="k">${escapeHtml(key.slice(0, 12))}…</span>" \\
  "${escapeHtml(base)}/v1/measurements?city=Delhi&amp;parameter=PM2.5&amp;start=2024-11-01&amp;end=2024-11-30&amp;agg=daily"</code></pre></div>
    <p class="small grey" style="margin-top:14px">Full reference: <a href="/#docs">endpoints</a> · <a href="/#examples">examples</a> · <a href="/v1/docs">interactive console</a></p>
  </div>
</div>
</main>` + footer(env);
}

export function messagePage(env: Env, title: string, message: string, ok = false): string {
  return head(`${title} · India Air Quality API`) + header(env, "other") + `
<main class="wrap">
<div class="hero" style="align-items:start;grid-template-columns:1fr;max-width:720px">
  <div>
    <p class="eyebrow">${ok ? "All good" : "Hmm"}</p>
    <h1 style="font-size:clamp(36px,5vw,54px)">${escapeHtml(title)}.</h1>
    <p class="lede">${escapeHtml(message)}</p>
    <div class="cta"><a class="btn plain" href="/signup">Back to sign up</a><a class="btn ghost plain" href="/">Documentation</a></div>
  </div>
</div>
</main>` + footer(env);
}

// ---------------------------------------------------------------------------
// Request-a-key page (SIGNUP_MODE = "request")
// ---------------------------------------------------------------------------
export function requestKeyPage(env: Env): string {
  const mailto = requestMailto(env);
  return head("Request an API key · India Air Quality API") + header(env, "signup") + `
<main class="wrap">
<div class="hero" style="align-items:start;padding-bottom:40px">
  <div>
    <p class="eyebrow">Request a key</p>
    <h1 style="font-size:clamp(36px,5vw,54px)">Email us, we'll send you a key.</h1>
    <p class="lede">Keys are free and have no limits. We issue them by hand so that we know who is using the data and what for, which helps us keep the service running and improve it.</p>
    <div class="cta"><a class="btn plain" href="${mailto}">Email ${escapeHtml(env.CONTACT_EMAIL)}</a></div>
    <p class="small grey" style="margin-top:18px">The button opens a pre-filled message. If it doesn't, write to <a href="${mailto}">${escapeHtml(env.CONTACT_EMAIL)}</a> with the details on the right.</p>
  </div>
  <div class="card"><span class="tag">Please include</span>
    <ol class="steps">
      <li><div><b>Your name.</b></div></li>
      <li><div><b>Which organisation you are with.</b> A university, agency, company, newsroom, or "independent" is fine.</div></li>
      <li><div><b>How you plan to use the data set.</b> A sentence or two: the question you are asking, the tool you are building, the story you are reporting.</div></li>
    </ol>
    <p class="small grey" style="margin-top:14px">We reply with your key, usually within a working day. Keys never expire; if one leaks or gets lost, email us and we'll rotate it.</p>
  </div>
</div>
<div class="pixels"></div>
<section class="first">
  <div class="cols">
    <div><h3>While you wait</h3><p>Read the <a href="/#docs">endpoint reference</a>, try the <a href="/#examples">examples</a>, or browse the <a href="/#bulk">bulk files</a>. Your first call will be <code>GET /v1/meta</code>, which tells you what's published.</p></div>
    <div><h3>Licence</h3><p>The compilation is released under <a href="https://creativecommons.org/licenses/by/4.0/">CC BY 4.0</a>. Credit the Central Pollution Control Board, the US Department of State, and <i>India Air Quality Database, XKDR Forum</i> in publications. Provided as is, without warranty; not validated for regulatory, legal or health decisions.</p></div>
  </div>
</section>
</main>` + footer(env);
}

// ---------------------------------------------------------------------------
// Demo page (/demo): a short, silent "screen recording" of someone handing the
// prompt to an AI coding assistant. The chart at the end uses real daily means
// for Delhi, November 2024, as returned by /v1/measurements.
// ---------------------------------------------------------------------------
const DEMO_DAILY = "221.9,216.2,220.4,228.7,208.1,201.5,228.9,209.4,180.3,203.4,178.2,193.1,271.3,390.1,300.1,318.4,382.3,565.7,375.5,261.8,214.9,262.5,182.7,144.1,225.9,209.7,175.9,181.4,187.4,183.4";

const DEMO_CSS = `<style>
.stage{position:relative;width:100%;aspect-ratio:16/9;background:#eae7e3;overflow:hidden;border:2px solid var(--ink);container-type:inline-size;margin-top:26px}
.stage *{font-variant-ligatures:none}
.layer{position:absolute;inset:0}
.slide{display:grid;place-content:center;justify-items:center;gap:2.2cqw;background:#fff;text-align:center;padding:4cqw;opacity:0;transition:opacity .5s ease}
.slide.on{opacity:1}
.slide svg{width:7cqw;height:auto}
.slide .big{font-family:var(--head);font-weight:800;font-size:4.4cqw;line-height:1.1;color:var(--ink)}
.slide .sub{font-family:var(--head);font-weight:800;font-size:2.2cqw;color:var(--coral)}
.slide .fine{font-size:1.7cqw;color:var(--grey);font-family:var(--body)}
.slide .url{font-family:var(--mono);font-size:2cqw;border-bottom:2px solid var(--coral)}
.win{position:absolute;background:#fff;border:2px solid var(--ink);box-shadow:0 1cqw 3cqw rgba(0,0,0,.14);opacity:0;transform:translateY(2cqw);transition:opacity .35s ease,transform .35s ease}
.win.on{opacity:1;transform:none}
.win .bar{display:flex;align-items:center;gap:.8cqw;padding:.9cqw 1.2cqw;background:#f0eeeb;border-bottom:2px solid var(--ink)}
.win .sq{width:.8cqw;height:.8cqw;background:#cfc9c2}
.win .sq.a{background:var(--coral)}
.win .name{font-family:var(--mono);font-size:1.15cqw;color:var(--grey);margin-left:.6cqw}
.win .body{padding:1.4cqw 1.6cqw;font-family:var(--mono);font-size:1.3cqw;line-height:1.75;color:var(--ink);white-space:pre-wrap;word-break:break-word}
#dterm{left:3cqw;top:4cqw;width:62cqw;height:48cqw;transition:width .45s ease}
#dterm.narrow{width:40cqw}
#dterm .body{height:calc(100% - 3.5cqw);overflow:hidden}
#denv{right:3cqw;top:10cqw;width:30cqw}
#dchart{right:3cqw;top:12cqw;width:52cqw}
#dchart .body{padding:1cqw}
.ln{display:block}
.ln .pr{color:var(--coral)}
.ln.dim{color:var(--grey)}
.ln.done{font-weight:700}
.ln.warn{color:#b7442f}
.dcaret{display:inline-block;width:.6cqw;height:1.5cqw;background:var(--coral);vertical-align:-.25cqw;animation:dblink 1s steps(1) infinite}
@keyframes dblink{50%{opacity:0}}
.dbadge{position:absolute;right:3cqw;bottom:3cqw;display:flex;align-items:center;gap:.8cqw;font-family:var(--head);font-weight:800;font-size:1.1cqw;letter-spacing:.18em;text-transform:uppercase;color:var(--grey)}
.dbadge svg{width:2.4cqw;height:auto}
.dcap{position:absolute;left:3cqw;bottom:3cqw;max-width:60cqw;font-family:var(--head);font-weight:700;font-size:1.5cqw;background:var(--coral);color:var(--ink);padding:.8cqw 1.2cqw;opacity:0;transition:opacity .3s ease}
.dcap.on{opacity:1}
.dbar{height:3px;background:var(--soft);margin-top:10px}
.dbar i{display:block;height:100%;width:0;background:var(--coral)}
#dprompt{white-space:pre-wrap;word-break:break-word}
@media(max-width:700px){.win .body{font-size:1.6cqw}.win .name{font-size:1.4cqw}}
</style>`;

const DEMO_JS = `<script>
document.addEventListener("DOMContentLoaded", function () {
  var vals = "${DEMO_DAILY}".split(",").map(Number);
  var peak = Math.max.apply(null, vals), pi = vals.indexOf(peak);
  var above = vals.filter(function (v) { return v > 60; }).length;
  var term = document.getElementById("dterm-body"), envb = document.getElementById("denv-body");
  var cap = document.getElementById("dcap"), bar = document.getElementById("dbar");
  var reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  var run = 0;
  function sleep(ms) { return new Promise(function (r) { setTimeout(r, reduce ? Math.min(ms, 60) : ms); }); }
  function show(id, on) { document.getElementById(id).classList.toggle("on", on); }
  function cue(t) { cap.textContent = t || ""; cap.classList.toggle("on", !!t); }
  function add(cls, html) { var s = document.createElement("span"); s.className = "ln " + (cls || ""); s.innerHTML = html; term.appendChild(s); term.scrollTop = term.scrollHeight; return s; }
  function type(node, text, cps, token) {
    var caret = document.createElement("i"); caret.className = "dcaret"; node.appendChild(caret);
    var i = 0;
    return new Promise(function (done) {
      (function step() {
        if (token !== run) { return done(); }
        if (i >= text.length) { caret.remove(); return done(); }
        caret.insertAdjacentText("beforebegin", text.charAt(i++));
        setTimeout(step, reduce ? 0 : 1000 / cps);
      })();
    });
  }
  function chart() {
    var W = 600, H = 360, L = 52, R = 14, T = 28, B = 34, maxY = 600;
    function x(i) { return L + i * (W - L - R) / (vals.length - 1); }
    function y(v) { return H - B - (v / maxY) * (H - T - B); }
    var d = "", i;
    for (i = 0; i < vals.length; i++) { d += (i ? "L" : "M") + x(i).toFixed(1) + "," + y(vals[i]).toFixed(1); }
    var area = d + "L" + x(vals.length - 1).toFixed(1) + "," + y(0) + "L" + x(0).toFixed(1) + "," + y(0) + "Z";
    var ticks = "";
    [0, 200, 400, 600].forEach(function (v) {
      ticks += '<line x1="' + L + '" x2="' + (W - R) + '" y1="' + y(v) + '" y2="' + y(v) + '" stroke="#e1ddd9" stroke-width="1"/>' +
        '<text x="' + (L - 8) + '" y="' + (y(v) + 4) + '" text-anchor="end" fill="#6a6a6a" font-size="11" font-family="ui-monospace, monospace">' + v + '</text>';
    });
    return '<svg viewBox="0 0 ' + W + ' ' + H + '" width="100%" height="100%" role="img" aria-label="Delhi daily mean PM2.5 for November 2024, every day above the 60 microgram standard">' +
      '<text x="' + L + '" y="16" fill="#1a1a1a" font-size="13" font-family="Montserrat, sans-serif" font-weight="700">Delhi \\u00b7 daily mean PM2.5 \\u00b7 Nov 2024</text>' + ticks +
      '<line x1="' + L + '" x2="' + (W - R) + '" y1="' + y(60) + '" y2="' + y(60) + '" stroke="#1a1a1a" stroke-width="1.2" stroke-dasharray="5 4"/>' +
      '<text x="' + (W - R) + '" y="' + (y(60) - 6) + '" text-anchor="end" fill="#1a1a1a" font-size="11" font-family="ui-monospace, monospace">standard 60</text>' +
      '<path d="' + area + '" fill="#f57d6a" fill-opacity="0.16" class="area" style="opacity:0"/>' +
      '<path d="' + d + '" fill="none" stroke="#f57d6a" stroke-width="2.6" stroke-linejoin="round" class="spark" pathLength="1" style="stroke-dasharray:1;stroke-dashoffset:1"/>' +
      '<circle cx="' + x(pi) + '" cy="' + y(peak) + '" r="4" fill="#f57d6a" class="pk" style="opacity:0"/>' +
      '<text x="' + x(pi) + '" y="' + (y(peak) - 10) + '" text-anchor="middle" fill="#1a1a1a" font-weight="700" font-size="11" font-family="ui-monospace, monospace" class="pk" style="opacity:0">' + Math.round(peak) + '</text>' +
      '<text x="' + L + '" y="' + (H - 10) + '" fill="#6a6a6a" font-size="11" font-family="ui-monospace, monospace">1 Nov</text>' +
      '<text x="' + (W - R) + '" y="' + (H - 10) + '" text-anchor="end" fill="#6a6a6a" font-size="11" font-family="ui-monospace, monospace">30 Nov</text></svg>';
  }
  async function play() {
    var token = ++run;
    term.innerHTML = ""; envb.innerHTML = ""; document.getElementById("dchart-body").innerHTML = "";
    ["dterm", "denv", "dchart", "dend"].forEach(function (id) { show(id, false); });
    document.getElementById("dterm").classList.remove("narrow");
    show("dstart", true); cue(""); bar.style.width = "0%";
    var t0 = Date.now(), total = 28000;
    var tick = setInterval(function () { bar.style.width = Math.min(100, (Date.now() - t0) / total * 100) + "%"; if (token !== run) clearInterval(tick); }, 100);

    await sleep(2600); if (token !== run) return;
    show("dstart", false); await sleep(400); show("dterm", true); await sleep(500);
    add("", '<span class="pr">$</span> claude');
    await sleep(700);
    var p = add("", '<span class="pr">\\u203a </span>');
    cue("Paste the prompt");
    await type(p, "Use the India Air Quality API from XKDR Forum (https://airquality.xkdr.org). Pull daily mean PM2.5 for Delhi for November 2024, save a CSV and plot it against the 60 \\u00b5g/m\\u00b3 daily standard.", 44, token);
    if (token !== run) return;
    cue(""); await sleep(1100);
    add("dim", "\\u23fa Reading airquality.xkdr.org/#docs"); await sleep(700);
    add("dim", "  GET /v1/meta \\u2192 196,521,834 readings \\u00b7 553 stations \\u00b7 2009-01 to 2026-03"); await sleep(800);
    add("dim", "\\u23fa Writing delhi_pm25.py"); await sleep(700);
    add("warn", "  ! No API key. Add it to .env as AQI_API_KEY \\u2014 free at airquality.xkdr.org/signup"); await sleep(500);
    if (token !== run) return;
    show("denv", true); cue("The only manual step: paste your key"); await sleep(600);
    var e = document.createElement("span"); e.className = "ln"; e.innerHTML = '<span class="dim"># India Air Quality API</span><br>'; envb.appendChild(e);
    await type(e, "AQI_API_KEY=aqi_7Qw3\\u2026", 26, token);
    if (token !== run) return;
    await sleep(700); cue(""); show("denv", false); await sleep(400);
    add("", '<span class="pr">$</span> python delhi_pm25.py'); await sleep(700);
    add("dim", "  GET /v1/measurements?city=Delhi&amp;parameter=PM2.5&amp;start=2024-11-01&amp;end=2024-11-30&amp;agg=daily"); await sleep(800);
    add("done", "  \\u2192 1,200 rows \\u00b7 0.3 s"); await sleep(600);
    add("dim", "  saved delhi_nov2024.csv"); await sleep(500);
    add("dim", "  saved delhi_nov2024.png"); await sleep(500);
    if (token !== run) return;
    document.getElementById("dterm").classList.add("narrow");
    await sleep(500);
    document.getElementById("dchart-body").innerHTML = chart();
    show("dchart", true);
    var spark = document.querySelector("#dchart-body .spark");
    if (spark && !reduce) {
      spark.animate([{ strokeDashoffset: 1 }, { strokeDashoffset: 0 }], { duration: 1600, fill: "forwards", easing: "ease-out" });
      setTimeout(function () { spark.style.strokeDashoffset = 0; }, 1700);
    } else if (spark) { spark.style.strokeDashoffset = 0; }
    document.querySelectorAll("#dchart-body .area, #dchart-body .pk").forEach(function (n) { n.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 900, delay: 900, fill: "forwards" }); });
    await sleep(2800);
    add("done", "\\u23fa Done. All " + above + " days of November 2024 sat above the 24-hour standard; peak " + Math.round(peak) + " \\u00b5g/m\\u00b3 on 18 Nov.");
    cue("Data: CPCB, via the India Air Quality Database");
    await sleep(3400);
    if (token !== run) return;
    cue(""); show("dend", true); clearInterval(tick); bar.style.width = "100%";
  }
  document.getElementById("dreplay").addEventListener("click", play);
  var copy = document.getElementById("dcopy");
  if (copy) copy.addEventListener("click", function () {
    var t = document.getElementById("dprompt").textContent;
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(t).then(function () { copy.textContent = "Copied"; setTimeout(function () { copy.textContent = "Copy prompt"; }, 1600); }, function () {});
    }
  });
  play();
});
</script>`;

export function demoPage(env: Env): string {
  const base = env.PUBLIC_URL;
  return head("Demo · India Air Quality API", DEMO_CSS + DEMO_JS) + header(env, "other") + `
<main class="wrap">
<div class="hero" style="align-items:start;padding-bottom:20px">
  <div>
    <p class="eyebrow">Demo</p>
    <h1 style="font-size:clamp(34px,4.6vw,50px)">From a prompt to a chart.</h1>
    <p class="lede">Half a minute: hand the prompt below to an AI coding assistant, paste your key into a <code>.env</code> file, and it pulls the data and plots it. The chart is real, straight from this API.</p>
  </div>
  <div class="card"><span class="tag">In short</span>
    <ol class="steps">
      <li><div><b>Paste the prompt</b> into the assistant.</div></li>
      <li><div><b>Paste your key</b> into <code>.env</code>. The only manual step.</div></li>
      <li><div><b>Keep the CSV and the chart.</b></div></li>
    </ol>
    <div class="cta" style="margin-top:6px"><a class="btn plain small" href="/signup">Get an API key</a></div>
  </div>
</div>

<div class="stage" id="dstage" role="img" aria-label="Screen recording: a prompt is typed into an AI coding assistant, an API key is added to a .env file, and a chart of Delhi's November 2024 PM2.5 appears.">
  <div class="layer">
    <div class="win" id="dterm">
      <div class="bar"><span class="sq a"></span><span class="sq"></span><span class="sq"></span><span class="name">zsh — air-quality</span></div>
      <div class="body" id="dterm-body"></div>
    </div>
    <div class="win" id="denv">
      <div class="bar"><span class="sq a"></span><span class="sq"></span><span class="sq"></span><span class="name">.env</span></div>
      <div class="body" id="denv-body"></div>
    </div>
    <div class="win" id="dchart">
      <div class="bar"><span class="sq a"></span><span class="sq"></span><span class="sq"></span><span class="name">delhi_nov2024.png</span></div>
      <div class="body" id="dchart-body"></div>
    </div>
    <div class="dbadge">${LOGO_MARK}<span>XKDR Forum</span></div>
    <div class="dcap" id="dcap"></div>
  </div>
  <div class="layer slide" id="dstart">
    ${LOGO_MARK}
    <div class="big">One prompt. Your own analysis.</div>
    <div class="sub">India Air Quality Database</div>
    <div class="fine">196 million hourly readings · 553 stations · 2009 onwards</div>
  </div>
  <div class="layer slide" id="dend">
    ${LOGO_MARK}
    <div class="big">Free API key in a minute.</div>
    <div class="url">${escapeHtml(base.replace(/^https?:\/\//, ""))}</div>
    <div class="fine">Hourly PM2.5, PM10, NO2, SO2, ozone and more, from CPCB and US Embassy monitors.</div>
  </div>
</div>
<div class="dbar"><i id="dbar"></i></div>
<div class="cta" style="margin-top:14px"><button class="btn small" id="dreplay" type="button">Replay</button></div>

<section id="prompt">
  <p class="eyebrow">Hand this out</p>
  <h2>The prompt</h2>
  <div class="cols">
    <div>
      <div class="code"><span class="lbl">Prompt</span><pre><code id="dprompt">Use the India Air Quality API from XKDR Forum. Docs: ${escapeHtml(base)}/#docs. My key is in .env as AQI_API_KEY.

Pull the daily mean PM2.5 for Delhi for November 2024, save it as CSV, and plot it against India's 60 µg/m³ daily standard.</code></pre></div>
      <div class="cta" style="margin-top:10px"><button class="btn ghost small" id="dcopy" type="button">Copy prompt</button></div>
    </div>
    <div>
      <h3>Why it works</h3>
      <p>The assistant reads <a href="/#docs">the endpoint reference</a>, calls <code>GET /v1/measurements</code> with the filters in the prompt, and gets tidy CSV back. No SDK, no scraping, no cleaning.</p>
      <p class="small grey">Every number in the demo is real: 1,200 rows for the month, and 30 days that all sat above the 24-hour standard. Swap the city, the pollutant or the dates and the same prompt still works.</p>
    </div>
  </div>
</section>
</main>` + footer(env);
}

// ---------------------------------------------------------------------------
// Admin key generator (client-side page; every action calls /admin/* with the admin secret)
// ---------------------------------------------------------------------------
export function adminPage(env: Env): string {
  const base = env.PUBLIC_URL;
  const script = `<script>
const BASE = ${JSON.stringify(base)};
const $ = (id) => document.getElementById(id);
let secret = sessionStorage.getItem("aqi_admin_secret") || "";
function hdr(){ return { "authorization": "Bearer " + secret, "content-type": "application/json" }; }
async function api(method, path, body){
  const r = await fetch(path, { method, headers: hdr(), body: body ? JSON.stringify(body) : undefined });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error || j.detail || ("HTTP " + r.status));
  return j;
}
function show(id, on){ $(id).hidden = !on; }
function flash(msg, bad){ const e = $("msg"); e.textContent = msg; e.className = "alert" + (bad ? " bad" : ""); e.hidden = !msg; }
async function unlock(){
  secret = $("secret").value.trim();
  try { await api("GET", "/admin/keys?email=__probe__"); sessionStorage.setItem("aqi_admin_secret", secret); show("login", false); show("app", true); flash(""); await refresh(); }
  catch (e) { flash("That secret was not accepted.", true); }
}
function lock(){ sessionStorage.removeItem("aqi_admin_secret"); secret = ""; show("app", false); show("login", true); }
function emailText(name, key, tier){
  const first = (name || "").trim().split(/\\s+/)[0] || "there";
  return "Hi " + first + ",\\n\\nThanks for your interest in the India Air Quality API. Here is your key:\\n\\n" + key +
    "\\n\\nSend it as a bearer token on every request, for example:\\n\\n" +
    'curl -H "Authorization: Bearer ' + key + '" "' + BASE + '/v1/measurements?city=Delhi&parameter=PM2.5&start=2024-11-01&end=2024-11-30&agg=daily&format=csv"' +
    "\\n\\nDocumentation and examples: " + BASE + "/\\nBulk Parquet files: " + BASE + "/#bulk\\n\\n" +
    (tier === "full" || tier === "admin" ? "The key has no rate limits or row caps. " : "This key is on the " + tier + " tier. ") +
    "Please keep it private; if it leaks or you lose it, email us and we'll rotate it. Please credit CPCB, the US Department of State and XKDR Forum in any publication.\\n\\nBest,\\nXKDR Forum";
}
async function issue(ev){
  ev.preventDefault();
  const email = $("email").value.trim().toLowerCase(), name = $("name").value.trim(), org = $("org").value.trim(), tier = $("tier").value;
  const note = org ? "org: " + org : "issued from /admin";
  try {
    const r = await api("POST", "/admin/keys", { email, name, tier, note });
    $("key").textContent = r.key; $("keyid").textContent = r.id; $("keytier").textContent = r.tier;
    const subject = "Your India Air Quality API key", body = emailText(name, r.key, r.tier);
    $("gmail").href = "https://mail.google.com/mail/?view=cm&to=" + encodeURIComponent(email) + "&su=" + encodeURIComponent(subject) + "&body=" + encodeURIComponent(body);
    $("mailto").href = "mailto:" + encodeURIComponent(email) + "?subject=" + encodeURIComponent(subject) + "&body=" + encodeURIComponent(body);
    $("emailbody").value = "To: " + email + "\\nSubject: " + subject + "\\n\\n" + body;
    show("result", true); flash("Key issued for " + email + ". It is shown once: send it now."); $("result").scrollIntoView({ behavior: "smooth" });
    await refresh();
  } catch (e) { flash("Could not issue key: " + e.message, true); }
}
function copy(id, btn){ navigator.clipboard.writeText(id === "key" ? $("key").textContent : $(id).value).then(() => { const t = btn.textContent; btn.textContent = "Copied"; setTimeout(() => btn.textContent = t, 1600); }); }
async function revoke(id, email){
  if (!confirm("Revoke key " + id + " (" + email + ")? This cannot be undone.")) return;
  try { await api("DELETE", "/admin/keys/" + id); flash("Revoked " + id + "."); await refresh(); } catch (e) { flash("Revoke failed: " + e.message, true); }
}
async function refresh(){
  const [k, u] = await Promise.all([api("GET", "/admin/keys"), api("GET", "/admin/usage?days=30")]);
  const use = Object.fromEntries((u.usage || []).map(x => [x.key_id, x]));
  const rows = (k.keys || []).map(x => {
    const s = x.revoked_at ? "revoked" : "active";
    return "<tr" + (x.revoked_at ? ' class="grey"' : "") + "><td><code>" + x.id + "</code></td><td>" + esc(x.owner_email) + "</td><td>" + esc(x.note || "") + "</td><td>" + x.tier + "</td><td>" + (x.created_at || "").slice(0, 10) + "</td><td>" + (x.last_used_at || "").slice(0, 10) + "</td><td>" + (use[x.id] ? use[x.id].requests : 0) + "</td><td>" +
      (x.revoked_at ? "revoked" : '<button class="btn small ghost" onclick="revoke(\\'' + x.id + '\\',\\'' + esc(x.owner_email) + '\\')">Revoke</button>') + "</td></tr>";
  });
  $("keys").innerHTML = rows.join("") || '<tr><td colspan="8" class="grey">No keys yet.</td></tr>';
}
function esc(s){ return String(s).replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"})[c]); }
window.addEventListener("DOMContentLoaded", async () => {
  if (secret) { try { await api("GET", "/admin/keys?email=__probe__"); show("login", false); show("app", true); await refresh(); } catch (e) { lock(); } }
});
</script>`;
  return head("Key generator · India Air Quality API", script + "<style>.alert.bad{border-color:#000}.small.ghost{margin:0}textarea.mono{font-family:var(--mono);font-size:12.5px;min-height:230px;background:#fff}</style>") + header(env, "other") + `
<main class="wrap">
<div id="login">
  <div class="hero" style="align-items:start;grid-template-columns:1fr 1fr">
    <div>
      <p class="eyebrow">Admin</p>
      <h1 style="font-size:clamp(36px,5vw,54px)">Key generator.</h1>
      <p class="lede">Issue API keys for people who emailed a request, and send them the key with one click. This page is for XKDR staff.</p>
    </div>
    <form class="card" onsubmit="event.preventDefault();unlock()">
      <div id="msg" class="alert" hidden></div>
      <label for="secret">Admin secret</label>
      <input type="password" id="secret" autocomplete="current-password" required>
      <button class="btn" type="submit" style="margin-top:22px;width:100%">Unlock</button>
      <p class="small grey" style="margin:14px 0 0">The secret is the Worker's ADMIN_SECRET (AQI_ADMIN_SECRET in the repo .env). It stays in this browser tab only.</p>
    </form>
  </div>
</div>

<div id="app" hidden>
  <div class="hero" style="align-items:start;grid-template-columns:1fr 1fr;padding-bottom:36px">
    <div>
      <p class="eyebrow">Admin</p>
      <h1 style="font-size:clamp(36px,5vw,54px)">Issue a key.</h1>
      <p class="lede">Copy the requester's details from their email. The key is generated on the spot and shown once; the buttons below open a ready-to-send reply.</p>
      <p><a href="#" onclick="lock();return false" class="small">Lock this page</a></p>
    </div>
    <form class="card" onsubmit="issue(event)">
      <div id="msg" class="alert" hidden></div>
      <label for="email">Requester's email</label>
      <input type="email" id="email" required placeholder="them@university.edu">
      <label for="name">Name</label>
      <input type="text" id="name" required>
      <label for="org">Organisation <span class="opt">and intended use, for your records</span></label>
      <input type="text" id="org" placeholder="IIT Delhi; PM2.5 exposure study">
      <label for="tier">Tier</label>
      <select id="tier" style="width:100%;background:#fff;border:2px solid #000;padding:12px 14px;font-family:var(--body);font-size:15px">
        <option value="full" selected>full · no rate limit, no row cap (default)</option>
        <option value="dashboard">dashboard · for a key embedded in a public web page (120 req/min, 100k rows)</option>
        <option value="research">research · 600 req/min, 5M rows</option>
        <option value="free">free · 60 req/min, 100k rows</option>
      </select>
      <button class="btn" type="submit" style="margin-top:24px;width:100%">Generate key</button>
    </form>
  </div>

  <div id="result" hidden>
    <div class="pixels"></div>
    <section class="first">
      <p class="eyebrow">Send it</p>
      <div class="cols">
        <div>
          <h3>The key</h3>
          <div class="keybox"><code id="key"></code><button class="btn small" type="button" onclick="copy('key', this)">Copy</button></div>
          <p class="small grey">id <code id="keyid"></code> · tier <b id="keytier"></b> · not retrievable again after you leave this page</p>
          <div class="cta"><a id="gmail" class="btn plain" href="#" target="_blank" rel="noopener">Open in Gmail</a><a id="mailto" class="btn ghost plain" href="#">Open in mail app</a></div>
        </div>
        <div>
          <h3>Or copy the message</h3>
          <textarea id="emailbody" class="mono" readonly></textarea>
          <button class="btn small ghost" type="button" onclick="copy('emailbody', this)" style="margin-top:10px">Copy message</button>
        </div>
      </div>
    </section>
  </div>

  <section>
    <p class="eyebrow">Issued keys</p>
    <h2>Who has one</h2>
    <div class="tablewrap"><table>
      <tr><th>Id</th><th>Email</th><th>Note</th><th>Tier</th><th>Issued</th><th>Last used</th><th>Requests, 30 d</th><th></th></tr>
      <tbody id="keys"></tbody>
    </table></div>
  </section>
</div>
</main>` + footer(env);
}
