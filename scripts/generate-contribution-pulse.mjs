#!/usr/bin/env node

import { mkdir, writeFile } from 'node:fs/promises';

const username = process.env.GITHUB_USERNAME || 'aron-76';
const token = process.env.PROFILE_STATS_TOKEN || process.env.GITHUB_TOKEN || process.env.GH_TOKEN;
const outputPath = process.env.OUTPUT_PATH || 'dist/contribution-pulse.svg';

const query = `
query ContributionPulse($login: String!) {
  user(login: $login) {
    contributionsCollection {
      contributionCalendar {
        totalContributions
        weeks {
          contributionDays {
            contributionCount
            date
            weekday
          }
        }
      }
    }
  }
}`;

async function fetchCalendar() {
  if (!token) return null;

  const response = await fetch('https://api.github.com/graphql', {
    method: 'POST',
    headers: {
      authorization: `Bearer ${token}`,
      'content-type': 'application/json',
      'user-agent': 'basehalf-profile-build-log',
    },
    body: JSON.stringify({ query, variables: { login: username } }),
  });

  if (!response.ok) {
    throw new Error(`GitHub GraphQL returned ${response.status}`);
  }

  const payload = await response.json();
  if (payload.errors?.length) {
    throw new Error(payload.errors.map((err) => err.message).join('; '));
  }

  return payload.data?.user?.contributionsCollection?.contributionCalendar ?? null;
}

function fallbackCalendar() {
  const today = new Date();
  const days = [];
  for (let i = 363; i >= 0; i -= 1) {
    const date = new Date(today);
    date.setUTCDate(today.getUTCDate() - i);
    const wave = Math.sin((i / 363) * Math.PI * 5);
    const focus = i > 315 ? 2 : i > 250 ? 1 : 0;
    const count = Math.max(0, Math.round(wave * 2 + focus));
    days.push({
      contributionCount: count,
      date: date.toISOString().slice(0, 10),
      weekday: date.getUTCDay(),
    });
  }

  const weeks = [];
  for (let i = 0; i < days.length; i += 7) {
    weeks.push({ contributionDays: days.slice(i, i + 7) });
  }
  return {
    totalContributions: days.reduce((sum, day) => sum + day.contributionCount, 0),
    weeks,
    fallback: true,
  };
}

function escapeXml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}

function monthLabels(days, startX, weekGap) {
  const labels = [];
  let lastMonth = null;
  days.forEach((day, index) => {
    const date = new Date(`${day.date}T00:00:00Z`);
    const month = date.getUTCMonth();
    if (month !== lastMonth) {
      lastMonth = month;
      const week = Math.floor(index / 7);
      const x = startX + week * weekGap;
      labels.push({ x, label: date.toLocaleString('en', { month: 'short', timeZone: 'UTC' }) });
    }
  });
  return labels;
}

function renderSvg(calendar) {
  const days = calendar.weeks.flatMap((week) => week.contributionDays);
  const max = Math.max(1, ...days.map((day) => day.contributionCount));
  const total = calendar.totalContributions ?? days.reduce((sum, day) => sum + day.contributionCount, 0);
  const activeDays = days.filter((day) => day.contributionCount > 0).length;
  const latestActive = [...days].reverse().find((day) => day.contributionCount > 0)?.date || 'no recent activity';
  const chart = {
    x: 44,
    y: 112,
    monthY: 92,
    cell: 10,
    weekGap: 16.1,
    dayGap: 15,
  };
  const chartEnd = chart.x + 52 * chart.weekGap + chart.cell;
  const cells = days
    .map((day, index) => {
      const week = Math.floor(index / 7);
      const weekday = day.weekday ?? index % 7;
      const intensity = day.contributionCount / max;
      const opacity = day.contributionCount === 0 ? 0.34 : 0.56 + intensity * 0.44;
      const level = day.contributionCount === 0 ? 'empty' : intensity > 0.72 ? 'high' : intensity > 0.38 ? 'mid' : 'low';
      const x = chart.x + week * chart.weekGap;
      const y = chart.y + weekday * chart.dayGap;
      return `<rect class="cell ${level}" x="${x.toFixed(1)}" y="${y}" width="${chart.cell}" height="${chart.cell}" rx="3" opacity="${opacity.toFixed(2)}"><title>${escapeXml(day.date)}: ${day.contributionCount} contributions</title></rect>`;
    })
    .join('\n    ');

  const months = monthLabels(days, chart.x, chart.weekGap)
    .map((month) => `<text class="month" x="${month.x.toFixed(1)}" y="${chart.monthY}">${month.label}</text>`)
    .join('\n    ');

  const fallbackNote = calendar.fallback
    ? 'Live data unavailable. Add PROFILE_STATS_TOKEN to include private contribution data.'
    : `Latest activity: ${latestActive}`;

  return `<svg width="1200" height="260" viewBox="0 0 1200 260" fill="none" xmlns="http://www.w3.org/2000/svg" role="img" aria-labelledby="title desc">
  <title id="title">GitHub contribution log</title>
  <desc id="desc">A quiet GitHub contribution log generated from contribution data.</desc>
  <style>
    .title { fill: #edecea; font: 720 28px Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
    .label { fill: #a9a8a2; font: 540 14px Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
    .metric { fill: #edecea; font: 720 30px Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
    .metric-label { fill: #8b8a84; font: 650 11px Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; letter-spacing: .12em; text-transform: uppercase; }
    .month { fill: #77766f; font: 650 11px Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; letter-spacing: .08em; }
    .rule { stroke: rgba(237, 236, 234, .08); stroke-width: 1; }
    .cell { shape-rendering: geometricPrecision; }
    .empty { fill: #292a26; }
    .low { fill: #787773; }
    .mid { fill: #9fa8c5; }
    .high { fill: #d0cfcc; }
    .baseline { stroke: url(#flow); stroke-width: 1.5; stroke-linecap: round; opacity: .76; }
    @media (prefers-color-scheme: light) {
      .title, .metric { fill: #24292f; }
      .label { fill: #57606a; }
      .metric-label, .month { fill: #6e7781; }
      .rule { stroke: rgba(36, 41, 47, .08); }
      .empty { fill: #d8dee4; }
      .low { fill: #8c959f; }
      .mid { fill: #6e80b6; }
      .high { fill: #24292f; }
    }
  </style>
  <defs>
    <linearGradient id="flow" x1="44" y1="225" x2="1148" y2="225" gradientUnits="userSpaceOnUse">
      <stop stop-color="#787773" stop-opacity=".72"/>
      <stop offset=".5" stop-color="#9fa8c5"/>
      <stop offset="1" stop-color="#d0cfcc" stop-opacity=".9"/>
    </linearGradient>
  </defs>

  <text class="title" x="44" y="38">Last 12 months</text>
  <text class="label" x="44" y="64">GitHub activity rendered as a build log</text>

  <text class="metric-label" x="910" y="30">contributions</text>
  <text class="metric" x="910" y="62">${total.toLocaleString('en-US')}</text>
  <text class="metric-label" x="1070" y="30">active days</text>
  <text class="metric" x="1070" y="62">${activeDays.toLocaleString('en-US')}</text>

  <g>
    ${months}
    <path class="rule" d="M${chart.x} ${chart.y}H${chartEnd.toFixed(1)}"/>
    <path class="rule" d="M${chart.x} ${chart.y + chart.dayGap * 3}H${chartEnd.toFixed(1)}"/>
    <path class="rule" d="M${chart.x} ${chart.y + chart.dayGap * 6}H${chartEnd.toFixed(1)}"/>
    ${cells}
  </g>

  <path class="baseline" d="M44 226C176 204 310 244 444 224C574 204 706 246 834 224C956 202 1040 230 1156 212"/>
  <text class="label" x="44" y="246">${escapeXml(fallbackNote)}</text>
</svg>
`;
}

async function main() {
  let calendar;
  try {
    calendar = await fetchCalendar();
  } catch (error) {
    console.warn(`[contribution-pulse] ${error.message}`);
  }

  if (!calendar) {
    calendar = fallbackCalendar();
  }

  const svg = renderSvg(calendar);
  await mkdir(outputPath.split('/').slice(0, -1).join('/') || '.', { recursive: true });
  await writeFile(outputPath, svg, 'utf8');
  console.log(`[contribution-pulse] wrote ${outputPath}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
