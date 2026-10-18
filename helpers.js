'use strict';

// Toshkent vaqti: UTC+5 (yozgi/qishki vaqt o'tishi yo'q). Kerak bo'lsa .env da TZ_OFFSET_HOURS bilan o'zgartiring.
const TZ_OFFSET = Number(process.env.TZ_OFFSET_HOURS || 5);
const HOUR = 3600e3;
const DAY = 24 * HOUR;

const pad = (n) => String(n).padStart(2, '0');

// Toshkent vaqtidagi komponentlar (dow: 0 = yakshanba)
function tzParts(ts = Date.now()) {
    const d = new Date(ts + TZ_OFFSET * HOUR);
    return { y: d.getUTCFullYear(), m: d.getUTCMonth() + 1, d: d.getUTCDate(), h: d.getUTCHours(), min: d.getUTCMinutes(), dow: d.getUTCDay() };
}

const fmt = (ts) => {
    const p = tzParts(ts);
    return `${pad(p.d)}.${pad(p.m)}.${p.y} ${pad(p.h)}:${pad(p.min)}`;
};

const dateKey = (ts = Date.now()) => {
    const p = tzParts(ts);
    return `${p.y}-${pad(p.m)}-${pad(p.d)}`;
};

const fromLocal = (y, mo, d, h, min) => Date.UTC(y, mo - 1, d, h, min) - TZ_OFFSET * HOUR;

// "25.10 18:00 matn", "25.10.2026 18:00 matn", "bugun 15:00 matn", "ertaga matn" (vaqt yozilmasa 18:00)
// Qaytaradi: null (muddat yo'q) | { error: 'invalid' | 'past' } | { at, rest }
const DL_RE = /^(?:(bugun|бугун|ertaga|эртага)|(\d{1,2})\.(\d{1,2})(?:\.(\d{4}|\d{2}))?)(?:\s+(\d{1,2})[:.](\d{2}))?(?=\s|$)\s*/i;

function parseDeadline(text, now = Date.now()) {
    const m = DL_RE.exec(text || '');
    if (!m) return null;
    const rest = text.slice(m[0].length).trim();

    let y, mo, d;
    if (m[1]) {
        const b = tzParts(now + (/^(ertaga|эртага)$/i.test(m[1]) ? DAY : 0));
        y = b.y; mo = b.m; d = b.d;
    } else {
        d = +m[2];
        mo = +m[3];
        y = m[4] ? (m[4].length === 2 ? 2000 + +m[4] : +m[4]) : tzParts(now).y;
    }
    const hh = m[5] !== undefined ? +m[5] : 18;
    const mm = m[6] !== undefined ? +m[6] : 0;
    if (hh > 23 || mm > 59 || mo < 1 || mo > 12 || d < 1 || d > 31) return { error: 'invalid' };

    const at = fromLocal(y, mo, d, hh, mm);
    const chk = tzParts(at);
    if (chk.d !== d || chk.m !== mo) return { error: 'invalid' }; // masalan 31.02
    if (at <= now) return { error: 'past' };
    return { at, rest };
}

const chunk = (arr, n) => {
    const out = [];
    for (let i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n));
    return out;
};

const short = (s, n) => {
    const t = String(s || '').replace(/\s+/g, ' ').trim();
    return t.length > n ? t.slice(0, n - 1) + '…' : t;
};

// /reyting va /hisobot uchun davr: hafta | oy | hammasi
function periodStart(arg, now = Date.now()) {
    const a = String(arg || '').toLowerCase();
    if (['hafta', 'ҳафта', 'week'].includes(a)) return { since: now - 7 * DAY, label: 'Сўнгги 7 кун', slug: 'hafta' };
    if (['oy', 'ой', 'month'].includes(a)) return { since: now - 30 * DAY, label: 'Сўнгги 30 кун', slug: 'oy' };
    if (['hammasi', 'барчаси', 'all'].includes(a)) return { since: 0, label: 'Барча давр', slug: 'hammasi' };
    return null;
}

// Ishtirokchilar bo'yicha statistika. tasks — task obyektlari massivi.
function computeStats(tasks) {
    const map = {};
    for (const t of tasks) {
        const open = t.status === 'open';
        for (const key of Object.keys(t.users || {})) {
            const u = t.users[key];
            const r = map[key] || (map[key] = { key, name: u.name, username: u.username || null, total: 0, onTime: 0, late: 0, missed: 0, pending: 0, excused: 0 });
            r.name = u.name;
            r.total++;
            if (u.status === 'bajarildi') {
                if (u.late) r.late++; else r.onTime++;
            } else if (u.excused) {
                r.excused++;
            } else if (u.late || !open) {
                r.missed++;
            } else {
                r.pending++;
            }
        }
    }
    const rows = Object.values(map).map((r) => {
        const base = r.total - r.excused;
        r.rate = base > 0 ? (r.onTime + r.late) / base : 0;
        return r;
    });
    rows.sort((a, b) => b.rate - a.rate || b.onTime - a.onTime || String(a.name).localeCompare(String(b.name)));
    return rows;
}

// Matn boshidagi "@ali @elbek #tuman1" kabi belgilarni ajratadi (vergul qo'yilsa ham bo'ladi).
// Qaytaradi: { handles: ['ali', ...], tags: ['tuman1', ...], rest }
function parseTargets(text) {
    let rest = String(text || '').trim();
    const handles = [];
    const tags = [];
    for (;;) {
        const m = /^([@#])([\p{L}\p{N}_]+)[,;]?(?=\s|$)\s*/u.exec(rest);
        if (!m) break;
        (m[1] === '@' ? handles : tags).push(m[2].toLowerCase());
        rest = rest.slice(m[0].length);
    }
    return { handles, tags, rest };
}

module.exports = { parseTargets, TZ_OFFSET, HOUR, DAY, tzParts, fmt, dateKey, parseDeadline, chunk, short, periodStart, computeStats };
