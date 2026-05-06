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
      'user-agent': 'basehalf-profile-pulse',
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

function monthLabels(days) {
  const labels = [];
  let lastMonth = null;
  days.forEach((day, index) => {
    const date = new Date(`${day.date}T00:00:00Z`);
    const month = date.getUTCMonth();
    if (month !== lastMonth) {
      lastMonth = month;
      const x = 54 + index * 2.7;
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
  const latestActive = [...days].reverse().find((day) => day.contributionCount > 0)?.date || 'no recent signal';
  const cells = days
    .map((day, index) => {
      const week = Math.floor(index / 7);
      const weekday = day.weekday ?? index % 7;
      const intensity = day.contributionCount / max;
      const radius = day.contributionCount === 0 ? 1.7 : 2.2 + intensity * 3.2;
      const opacity = day.contributionCount === 0 ? 0.2 : 0.42 + intensity * 0.58;
      const hue = day.contributionCount === 0 ? '#26354f' : intensity > 0.72 ? '#5eead4' : intensity > 0.38 ? '#22d3ee' : '#2563eb';
      const x = 54 + week * 14.4;
      const y = 118 + weekday * 18;
      const recentClass = index > days.length - 38 && day.contributionCount > 0 ? ' recent' : '';
      return `<circle class="dot${recentClass}" cx="${x.toFixed(1)}" cy="${y}" r="${radius.toFixed(2)}" fill="${hue}" opacity="${opacity.toFixed(2)}"><title>${escapeXml(day.date)}: ${day.contributionCount} contributions</title></circle>`;
    })
    .join('\n    ');

  const months = monthLabels(days)
    .map((month) => `<text class="month" x="${month.x.toFixed(1)}" y="95">${month.label}</text>`)
    .join('\n    ');

  const fallbackNote = calendar.fallback
    ? 'Fallback signal shown. Add PROFILE_STATS_TOKEN for live GitHub data.'
    : `Latest active signal: ${latestActive}`;

  return `<svg width="1200" height="310" viewBox="0 0 1200 310" fill="none" xmlns="http://www.w3.org/2000/svg" role="img" aria-labelledby="title desc">
  <title id="title">Contribution Pulse</title>
  <desc id="desc">A Basehalf-style contribution pulse generated from GitHub contribution data.</desc>
  <style>
    .bg { fill: #070d19; }
    .panel { fill: rgba(15, 23, 42, .88); stroke: rgba(148, 163, 184, .2); stroke-width: 1; }
    .title { fill: #f8fafc; font: 800 28px Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
    .label { fill: #94a3b8; font: 500 13px Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
    .metric { fill: #dff8ff; font: 800 24px Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
    .month { fill: #64748b; font: 600 10px Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; letter-spacing: .05em; }
    .rule { stroke: rgba(148, 163, 184, .11); stroke-width: 1; }
    .dot { filter: drop-shadow(0 0 8px rgba(34, 211, 238, .12)); }
    .recent { animation: pulse 3.4s ease-in-out infinite; transform-origin: center; }
    .flow { stroke: url(#flow); stroke-width: 1.4; stroke-linecap: round; stroke-dasharray: 70 360; animation: flow 9s linear infinite; opacity: .72; }
    @keyframes pulse { 0%, 100% { opacity: .45; } 50% { opacity: 1; } }
    @keyframes flow { to { stroke-dashoffset: -430; } }
    @media (prefers-reduced-motion: reduce) { .recent, .flow { animation: none; } }
  </style>
  <defs>
    <linearGradient id="shell" x1="0" y1="0" x2="1200" y2="310" gradientUnits="userSpaceOnUse">
      <stop stop-color="#071020"/>
      <stop offset=".55" stop-color="#0f172a"/>
      <stop offset="1" stop-color="#06151b"/>
    </linearGradient>
    <radialGradient id="glow" cx="0" cy="0" r="1" gradientUnits="userSpaceOnUse" gradientTransform="translate(840 140) rotate(90) scale(170 520)">
      <stop stop-color="#14b8a6" stop-opacity=".28"/>
      <stop offset="1" stop-color="#14b8a6" stop-opacity="0"/>
    </radialGradient>
    <linearGradient id="flow" x1="48" y1="246" x2="1088" y2="246" gradientUnits="userSpaceOnUse">
      <stop stop-color="#2563eb"/>
      <stop offset=".5" stop-color="#22d3ee"/>
      <stop offset="1" stop-color="#5eead4"/>
    </linearGradient>
  </defs>
  <rect width="1200" height="310" rx="28" fill="url(#shell)"/>
  <rect x="18" y="18" width="1164" height="274" rx="22" fill="url(#glow)"/>
  <rect class="panel" x="34" y="34" width="1132" height="242" rx="18"/>

  <text class="title" x="58" y="70">Contribution Pulse</text>
  <text class="label" x="58" y="98">private-safe activity intensity, rendered as Basehalf signal nodes</text>

  <text class="metric" x="954" y="70" text-anchor="end">${total.toLocaleString('en-US')}</text>
  <text class="label" x="966" y="70">contributions</text>
  <text class="metric" x="954" y="102" text-anchor="end">${activeDays.toLocaleString('en-US')}</text>
  <text class="label" x="966" y="102">active days</text>

  <g>
    ${months}
    <path class="rule" d="M50 118H818"/>
    <path class="rule" d="M50 172H818"/>
    <path class="rule" d="M50 226H818"/>
    ${cells}
  </g>

  <path class="flow" d="M58 252C190 224 306 282 430 252C546 224 666 286 788 252C910 220 1002 258 1128 238"/>
  <text class="label" x="58" y="272">${escapeXml(fallbackNote)}</text>
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
