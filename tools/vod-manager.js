#!/usr/bin/env node
/**
 * VOD Manager CLI - Add, list, edit, remove VOD entries for Obliviosa archive
 * Usage: node vod-manager.js <command> [args]
 * Commands: add <youtube-url>, import <playlist-url>, autotag, list, edit <id>, remove <id>, stats
 */

import { createInterface } from 'readline';
import { writeFileSync, readFileSync, existsSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_PATH = join(__dirname, '..', 'data', 'vods.json');

function loadData() {
    if (!existsSync(DATA_PATH)) {
        return { vods: [] };
    }
    return JSON.parse(readFileSync(DATA_PATH, 'utf-8'));
}

/** Keep the file in chronological order so appends don't scatter entries. */
function saveData(data) {
    data.vods = [...(data.vods || [])].sort(
        (a, b) => (a.date || '').localeCompare(b.date || '') || (a.id || '').localeCompare(b.id || '')
    );
    writeFileSync(DATA_PATH, JSON.stringify(data, null, 2), 'utf-8');
}

const AUTOTAG_MAX = 6;

/**
 * Derive tags from game + title + description (replaces hand-maintained tags).
 */
function computeAutotags(vod) {
    const titleRaw = vod.title || '';
    const descRaw = vod.description || '';
    const t = `${titleRaw} ${descRaw}`.toLowerCase().replace(/['''`]/g, "'");
    const game = (vod.game || '').trim();

    const secondary = [];
    const push = (tag) => {
        if (!tag || secondary.includes(tag)) return;
        if (game && tag === game) return;
        secondary.push(tag);
    };

    if (/@[a-z0-9_-]+/i.test(titleRaw) || /theonemanny/i.test(t) || /beholdbrooke|friends\s*x|\bdnd with/i.test(t)) {
        push('Collab');
    }

    if (game === 'DND' || /\bd\/?d\b|\bdnd\b|dungeon\s*&\s*dragons/i.test(t)) {
        push('Tabletop');
    }

    if (/christmas|xmas/i.test(t)) push('Holiday');
    if (/last stream of 202\d|(?<!lunar )new year/i.test(t)) push('Year End');
    if (/lunar new year/i.test(t)) push('Lunar New Year');
    if (/women'?s day/i.test(t)) {
        push('Event');
        push("Women's Day");
    }
    if (/st\.?\s*patr?icks|paddy|🍀/i.test(t)) {
        push('Event');
        push("St Patrick's Day");
    }
    if (/easter|bunny/i.test(t)) {
        push('Event');
        push('Easter');
    }

    const artStream = game === 'Art' || /draw|drawing|sketch/i.test(t);
    if (artStream) {
        push('Drawing');
        if (/emote/i.test(t)) push('Emotes');
    }

    const blindPhrase = /\bblind\b/i.test(t);
    const firstPlay =
        /\bfirst time\b|\b1st time\b|\bfirst look\b|\b1st\s+look\b/i.test(t) ||
        /\bfirst\b[^.]{0,40}\b(playthrough|play)\b/i.test(t);
    if (firstPlay || blindPhrase) {
        push('First Playthrough');
        if (blindPhrase) push('Blind');
    }

    if (/subathon/i.test(t)) push('Subathon');
    if (/\bb-?day\b|birthday/i.test(t)) push('Birthday');

    if (
        /how you doin|come hang|lovelies|lovies|cuties|hang with|howdy|play with me|play peoples|join to play|multigaming|happy (monday|tuesday|wednesday|thursday|friday|saturday|sunday)|\bheya\b|\bello\b/i.test(
            t
        )
    ) {
        push('Community');
    }

    if (/i'?m back\b/i.test(t)) push('Comeback');
    if (/tipsy|impromptu tipsy/i.test(t)) {
        push('Just Chatting');
        push('Social');
    }
    if (/chillin|chill\b|monday blue|weird thing|catch up|ridiculously late/i.test(t)) push('Chill');
    if (/time is weird|monday chill/i.test(t)) push('Just Chatting');
    if (/health scare|minor health/i.test(t)) {
        push('IRL');
        push('Community');
    }

    if (/multigaming|\bvariety\b/i.test(t) || game === 'Variety' || game === 'Gaming') push('Variety');
    if (/marvel rivals/i.test(t)) push('Marvel Rivals');
    if (/puzzle/i.test(t)) push('Puzzle');
    if (/\bjam\b|going to the jam/i.test(t)) push('Music');
    if (/\bmusic\b/i.test(t)) push('Music');

    if (/uninstall/i.test(t)) push('Meme');

    if (game === 'Elden Ring') push('RPG');
    if (game === 'Clair Obscur Expedition 33') push('RPG');
    if (game === 'Monster Hunter Wilds') push('Action RPG');
    if (game === 'Minecraft') push('Sandbox');
    if (game === 'REPO') {
        push('Co-op');
        push('Horror');
    }
    if (/^resident evil/i.test(game)) push('Horror');

    const out = [];
    if (game) out.push(game);
    for (const s of secondary) {
        if (!out.includes(s)) out.push(s);
    }
    return out.slice(0, AUTOTAG_MAX);
}

function cmdAutotag() {
    const data = loadData();
    const vods = data.vods || [];
    let n = 0;
    for (const vod of vods) {
        vod.tags = computeAutotags(vod);
        n += 1;
    }
    saveData(data);
    console.log(`Autotagged ${n} VOD(s). Tags capped at ${AUTOTAG_MAX} each.`);
}

function prompt(question) {
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    return new Promise((resolve) => {
        rl.question(question, (answer) => {
            rl.close();
            resolve(answer.trim());
        });
    });
}

function extractYoutubeId(url) {
    const match = url.match(/(?:youtube\.com\/(?:[^/]+\/.+\/|(?:v|e(?:mbed)?)\/|.*[?&]v=)|youtu\.be\/)([^"&?/\s]{11})/);
    return match ? match[1] : null;
}

function extractPlaylistId(url) {
    const match = url.match(/(?:list=)([^&]+)/);
    return match ? match[1] : null;
}

function slugify(str) {
    return str
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-|-$/g, '');
}

function formatDuration(seconds) {
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = Math.floor(seconds % 60);
    if (h > 0) {
        return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
    }
    return `${m}:${String(s).padStart(2, '0')}`;
}

const YT_HEADERS = {
    'User-Agent':
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36',
    'Accept-Language': 'en-US,en',
};

/** Uploader name stamped into raw VOD titles; stripped for display. */
const CHANNEL_NOISE = /\bObliviosa\s*Official\b/gi;
/** Trailing language/encoder tail: "ENG／FR", "[Eng／Fr]nvenc_av1_10bit", "Eng／Fr video". */
const ENCODER_NOISE = /[\s\[(]+ENG\b[\s\S]*$|[\s\[(]+nvenc[\s\S]*$/i;
/** Leading "M D YY" / "[M-D-YY] -" stream-date stamp. */
const DATE_PREFIX = /^\s*\[?\s*(\d{1,2})[\s\-/.](\d{1,2})[\s\-/.](\d{2})\s*\]?\s*-?\s*/;

const TITLE_MAX = 100;
const ID_MAX = 95;

/**
 * Raw uploads are titled "M D YY ObliviosaOfficial   Real title ENG／FR".
 * Returns the stream date from that prefix (falling back to the upload date)
 * plus the leftover title text.
 */
function parseRawTitle(rawTitle, fallbackDate) {
    let date = fallbackDate;
    let rest = rawTitle;

    const m = rawTitle.match(DATE_PREFIX);
    if (m) {
        const [, mm, dd, yy] = m;
        const year = 2000 + Number(yy);
        const month = Number(mm);
        const day = Number(dd);
        if (year >= 2015 && year <= 2099 && month >= 1 && month <= 12 && day >= 1 && day <= 31) {
            date = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
            rest = rawTitle.slice(m[0].length);
        }
    }
    return { date, rest };
}

/**
 * Match the archive's display style: Title Case, but leave all-caps words
 * (REPO, REQUIEM) alone and capitalise after digits ("1st" -> "1St").
 */
function titleCase(str) {
    return str.replace(/\S+/g, (word) => {
        if (word.length > 1 && word === word.toUpperCase() && /[A-Z]/.test(word)) return word;
        return word
            .toLowerCase()
            .replace(/^([^a-z0-9]*)([a-z])/, (_, lead, ch) => lead + ch.toUpperCase())
            .replace(/(\d)([a-z])/g, (_, d, ch) => d + ch.toUpperCase());
    });
}

/** Strip uploader stamp and encoder tail, normalise case and spacing, cap length. */
function cleanTitle(restOfTitle) {
    const cleaned = titleCase(
        restOfTitle.replace(CHANNEL_NOISE, ' ').replace(ENCODER_NOISE, '').replace(/\s+/g, ' ').trim()
    );
    return cleaned.length > TITLE_MAX ? cleaned.slice(0, TITLE_MAX).trim() : cleaned;
}

/** Archive ids read "M-D-YY-slug-of-title". */
function makeId(title, date, videoId, takenIds) {
    const [y, m, d] = date.split('-');
    const prefix = `${Number(m)}-${Number(d)}-${y.slice(2)}-`;
    const base = (prefix + slugify(title)).slice(0, ID_MAX).replace(/-+$/, '') || `vod-${videoId}`;
    if (!takenIds.has(base)) return base;
    for (let n = 2; n < 100; n++) {
        const candidate = `${base}-${n}`;
        if (!takenIds.has(candidate)) return candidate;
    }
    return `vod-${videoId}`;
}

/**
 * Read every video in a public playlist straight off the watch pages.
 * YouTube renders playlist rows lazily, so the first page carries only a
 * continuation token and the rest arrive from the InnerTube browse endpoint.
 */
async function fetchPlaylistItems(playlistId) {
    const html = await (
        await fetch(`https://www.youtube.com/playlist?list=${playlistId}`, { headers: YT_HEADERS })
    ).text();

    const apiKey = html.match(/"INNERTUBE_API_KEY":"([^"]+)"/)?.[1];
    const clientVersion = html.match(/"INNERTUBE_CLIENT_VERSION":"([^"]+)"/)?.[1];
    const initialMatch = html.match(/var ytInitialData = (\{.*?\});<\/script>/s);
    if (!apiKey || !initialMatch) {
        throw new Error('Could not read the playlist page (is the playlist public?).');
    }
    const initial = JSON.parse(initialMatch[1]);
    const playlistTitle = initial?.metadata?.playlistMetadataRenderer?.title || playlistId;

    const seen = new Set();
    const items = [];
    const collect = (node) => {
        (function walk(n) {
            if (!n || typeof n !== 'object') return;
            if (Array.isArray(n)) return n.forEach(walk);

            // Current shape: lockupViewModel. Older shape: playlistVideoRenderer.
            const lockup = n.lockupViewModel;
            if (lockup?.contentType === 'LOCKUP_CONTENT_TYPE_VIDEO' && lockup.contentId && !seen.has(lockup.contentId)) {
                seen.add(lockup.contentId);
                items.push({
                    videoId: lockup.contentId,
                    title: lockup.metadata?.lockupMetadataViewModel?.title?.content || '',
                });
            }
            const legacy = n.playlistVideoRenderer;
            if (legacy?.videoId && !seen.has(legacy.videoId)) {
                seen.add(legacy.videoId);
                items.push({
                    videoId: legacy.videoId,
                    title: legacy.title?.runs?.map((r) => r.text).join('') || legacy.title?.simpleText || '',
                });
            }
            for (const k in n) walk(n[k]);
        })(node);
    };
    const nextToken = (node) => JSON.stringify(node).match(/"continuationCommand":\{"token":"([^"]+)"/)?.[1];

    collect(initial);
    let token = nextToken(initial);
    const context = { client: { clientName: 'WEB', clientVersion: clientVersion || '2.20240101.00.00', hl: 'en', gl: 'US' } };

    for (let page = 0; token && page < 60; page++) {
        const before = items.length;
        const res = await fetch(`https://www.youtube.com/youtubei/v1/browse?key=${apiKey}&prettyPrint=false`, {
            method: 'POST',
            headers: { ...YT_HEADERS, 'Content-Type': 'application/json' },
            body: JSON.stringify({ context, continuation: token }),
        });
        const json = await res.json();
        collect(json);
        if (items.length === before) break;
        token = nextToken(json);
    }

    return { playlistTitle, items };
}

/** Exact duration + upload date, read from the watch page (no API key needed). */
async function fetchVideoDetails(videoId) {
    try {
        const html = await (
            await fetch(`https://www.youtube.com/watch?v=${videoId}`, { headers: YT_HEADERS })
        ).text();
        const m =
            html.match(/var ytInitialPlayerResponse = (\{.*?\});var/s) ||
            html.match(/ytInitialPlayerResponse\s*=\s*(\{.*?\});<\/script>/s);
        if (!m) return null;
        const pr = JSON.parse(m[1]);
        return {
            title: pr.videoDetails?.title || '',
            lengthSeconds: Number(pr.videoDetails?.lengthSeconds) || 0,
            description: (pr.videoDetails?.shortDescription || '').trim(),
            uploadDate: (pr.microformat?.playerMicroformatRenderer?.uploadDate || '').slice(0, 10),
        };
    } catch {
        return null;
    }
}

async function fetchYoutubeMetadata(videoId) {
    const oEmbedUrl = `https://www.youtube.com/oembed?url=https://www.youtube.com/watch?v=${videoId}&format=json`;
    try {
        const res = await fetch(oEmbedUrl);
        if (!res.ok) return null;
        const data = await res.json();
        return { title: data.title };
    } catch {
        return null;
    }
}

async function cmdAdd(url) {
    const videoId = extractYoutubeId(url);
    if (!videoId) {
        console.error('Invalid YouTube URL. Use format: https://www.youtube.com/watch?v=VIDEO_ID');
        process.exit(1);
    }

    const meta = await fetchYoutubeMetadata(videoId);
    const defaultTitle = meta?.title || 'Untitled VOD';

    console.log('\nVideo found:', defaultTitle);
    console.log('Enter details (press Enter to use default):\n');

    const title = (await prompt(`Title [${defaultTitle}]: `)) || defaultTitle;
    const date = (await prompt('Date (YYYY-MM-DD): ')) || new Date().toISOString().slice(0, 10);
    const game = await prompt('Game: ');
    const tagsStr = await prompt('Tags (comma-separated): ');
    const tags = tagsStr ? tagsStr.split(',').map((t) => t.trim()).filter(Boolean) : [];
    const description = await prompt('Description: ');

    let durationStr = await prompt('Duration (e.g. 3:45:22 or 225 for minutes): ');
    let durationSeconds = 0;
    if (durationStr) {
        const parts = durationStr.split(':').map(Number);
        if (parts.length === 3) {
            durationSeconds = parts[0] * 3600 + parts[1] * 60 + parts[2];
        } else if (parts.length === 2) {
            durationSeconds = parts[0] * 60 + parts[1];
        } else {
            durationSeconds = parseInt(durationStr, 10) * 60;
        }
    }

    const id = slugify(title) || `vod-${videoId}`;
    const duration = durationSeconds > 0 ? formatDuration(durationSeconds) : '';

    const vod = {
        id,
        title,
        date,
        game: game || '',
        tags,
        duration,
        durationSeconds,
        youtubeId: videoId,
        description: description || '',
    };

    const data = loadData();
    const existing = data.vods.findIndex((v) => v.id === id || v.youtubeId === videoId);
    if (existing >= 0) {
        const overwrite = await prompt(`VOD with id "${id}" exists. Overwrite? (y/N): `);
        if (overwrite.toLowerCase() !== 'y') {
            console.log('Aborted.');
            process.exit(0);
        }
        data.vods[existing] = vod;
    } else {
        data.vods.push(vod);
    }

    saveData(data);
    console.log('\nVOD saved successfully.');
}

async function cmdImport(playlistUrl) {
    const playlistId = extractPlaylistId(playlistUrl);
    if (!playlistId) {
        console.error('Invalid playlist URL. Use format: https://www.youtube.com/playlist?list=PLAYLIST_ID');
        process.exit(1);
    }

    try {
        console.log(`\nReading playlist ${playlistId} ...`);
        const { playlistTitle, items } = await fetchPlaylistItems(playlistId);
        console.log(`Playlist "${playlistTitle}": ${items.length} video(s) listed.`);
        if (items.length === 0) {
            console.log('Nothing to import.');
            return;
        }

        const data = loadData();
        const existingVideoIds = new Set(data.vods.map((v) => v.youtubeId));
        const takenIds = new Set(data.vods.map((v) => v.id));
        // Same stream uploaded twice: identical date + title + runtime.
        const fingerprints = new Set(data.vods.map((v) => `${v.date}|${v.title}|${v.durationSeconds}`));

        const added = [];
        const skipped = [];

        for (const [i, item] of items.entries()) {
            process.stdout.write(`  [${i + 1}/${items.length}] ${item.videoId} ... `);

            if (existingVideoIds.has(item.videoId)) {
                console.log('already archived');
                skipped.push({ videoId: item.videoId, reason: 'already archived' });
                continue;
            }

            const details = await fetchVideoDetails(item.videoId);
            const rawTitle = details?.title || item.title || 'Untitled';
            const parsed = parseRawTitle(rawTitle, details?.uploadDate || new Date().toISOString().slice(0, 10));
            const title = cleanTitle(parsed.rest) || cleanTitle(rawTitle) || 'Untitled';
            const date = parsed.date;
            const durationSeconds = details?.lengthSeconds || 0;

            const fingerprint = `${date}|${title}|${durationSeconds}`;
            if (fingerprints.has(fingerprint)) {
                console.log('duplicate upload');
                skipped.push({ videoId: item.videoId, reason: `duplicate of an entry already added (${title})` });
                continue;
            }

            const id = makeId(title, date, item.videoId, takenIds);
            const vod = {
                id,
                title,
                date,
                game: '',
                tags: [],
                duration: durationSeconds > 0 ? formatDuration(durationSeconds) : '',
                durationSeconds,
                youtubeId: item.videoId,
                description: details?.description || '',
            };
            vod.tags = computeAutotags(vod);

            data.vods.push(vod);
            existingVideoIds.add(item.videoId);
            takenIds.add(id);
            fingerprints.add(fingerprint);
            added.push(vod);
            console.log(`added (${date}, ${vod.duration || 'no duration'})`);
        }

        saveData(data);

        console.log(`\nImported ${added.length} VOD(s); skipped ${skipped.length}.`);
        for (const s of skipped) {
            console.log(`  skipped ${s.videoId}: ${s.reason}`);
        }
        const missingGame = added.filter((v) => !v.game);
        if (missingGame.length > 0) {
            console.log(
                `\n${missingGame.length} new entr${missingGame.length === 1 ? 'y has' : 'ies have'} no game set ` +
                    '(YouTube exposes none). Set them with: node vod-manager.js edit <id>'
            );
        }
    } catch (err) {
        console.error('Import failed:', err.message);
        process.exit(1);
    }
}

function cmdList() {
    const data = loadData();
    const vods = data.vods || [];
    if (vods.length === 0) {
        console.log('No VODs in archive.');
        return;
    }
    console.log('\nVOD Archive:\n');
    vods.forEach((v, i) => {
        console.log(`${i + 1}. [${v.id}] ${v.title}`);
        console.log(`   Game: ${v.game || '-'} | Date: ${v.date} | ${v.duration || '-'}`);
    });
}

async function cmdEdit(id) {
    const data = loadData();
    const idx = data.vods.findIndex((v) => v.id === id);
    if (idx < 0) {
        console.error(`VOD not found: ${id}`);
        process.exit(1);
    }
    const vod = data.vods[idx];
    console.log('\nEditing:', vod.title);
    console.log('Press Enter to keep current value.\n');

    const title = (await prompt(`Title [${vod.title}]: `)) || vod.title;
    const date = (await prompt(`Date [${vod.date}]: `)) || vod.date;
    const game = (await prompt(`Game [${vod.game}]: `)) ?? vod.game;
    const tagsStr = await prompt(`Tags [${(vod.tags || []).join(', ')}]: `);
    const tags = tagsStr ? tagsStr.split(',').map((t) => t.trim()).filter(Boolean) : (vod.tags || []);
    const description = (await prompt(`Description [${vod.description}]: `)) ?? vod.description;

    data.vods[idx] = { ...vod, title, date, game, tags, description };
    saveData(data);
    console.log('\nVOD updated.');
}

function cmdRemove(id) {
    const data = loadData();
    const idx = data.vods.findIndex((v) => v.id === id);
    if (idx < 0) {
        console.error(`VOD not found: ${id}`);
        process.exit(1);
    }
    const vod = data.vods[idx];
    createInterface({ input: process.stdin, output: process.stdout }).question(
        `Remove "${vod.title}"? (y/N): `,
        (answer) => {
            if (answer.toLowerCase() === 'y') {
                data.vods.splice(idx, 1);
                saveData(data);
                console.log('VOD removed.');
            } else {
                console.log('Aborted.');
            }
            process.exit(0);
        }
    );
}

function cmdStats() {
    const data = loadData();
    const vods = data.vods || [];
    const totalHours = vods.reduce((sum, v) => sum + (v.durationSeconds || 0), 0) / 3600;
    const games = [...new Set(vods.map((v) => v.game).filter(Boolean))];
    console.log('\nArchive stats:');
    console.log(`  VODs: ${vods.length}`);
    console.log(`  Total hours: ${totalHours.toFixed(1)}`);
    console.log(`  Games: ${games.length}`);
    console.log('');
}

const commands = {
    add: cmdAdd,
    import: cmdImport,
    autotag: cmdAutotag,
    list: cmdList,
    edit: cmdEdit,
    remove: cmdRemove,
    stats: cmdStats,
};

const args = process.argv.slice(2);
const cmd = args[0];
const cmdFn = commands[cmd];

if (!cmdFn) {
    console.log('Usage: node vod-manager.js <command> [args]');
    console.log(
        'Commands: add <youtube-url>, import <playlist-url>, autotag, list, edit <id>, remove <id>, stats'
    );
    process.exit(1);
}

if (cmd === 'add' && !args[1]) {
    console.error('Usage: node vod-manager.js add <youtube-url>');
    process.exit(1);
}
if (cmd === 'import' && !args[1]) {
    console.error('Usage: node vod-manager.js import <playlist-url>');
    process.exit(1);
}
if ((cmd === 'edit' || cmd === 'remove') && !args[1]) {
    console.error(`Usage: node vod-manager.js ${cmd} <id>`);
    process.exit(1);
}

if (cmd === 'add' || cmd === 'import') {
    cmdFn(args[1]).catch((err) => {
        console.error(err);
        process.exit(1);
    });
} else if (cmd === 'edit') {
    cmdFn(args[1]).catch((err) => {
        console.error(err);
        process.exit(1);
    });
} else if (cmd === 'remove') {
    cmdFn(args[1]);
} else {
    cmdFn();
}
