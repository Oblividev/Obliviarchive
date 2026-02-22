#!/usr/bin/env node
/**
 * VOD Manager CLI - Add, list, edit, remove VOD entries for Obliviosa archive
 * Usage: node vod-manager.js <command> [args]
 * Commands: add <youtube-url>, import <playlist-url>, list, edit <id>, remove <id>, stats
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

function saveData(data) {
    writeFileSync(DATA_PATH, JSON.stringify(data, null, 2), 'utf-8');
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

    console.log('\nPlaylist import requires a YouTube Data API key.');
    console.log('Get one at: https://console.cloud.google.com/apis/credentials');
    const apiKey = await prompt('YouTube API key (or press Enter to skip): ');
    if (!apiKey) {
        console.log('Skipping import. Use "add" command for single videos (no API key needed).');
        process.exit(0);
    }

    try {
        const res = await fetch(
            `https://www.googleapis.com/youtube/v3/playlistItems?part=snippet,contentDetails&playlistId=${playlistId}&maxResults=50&key=${apiKey}`
        );
        const json = await res.json();
        if (json.error) {
            console.error('API error:', json.error.message);
            process.exit(1);
        }
        const items = json.items || [];
        if (items.length === 0) {
            console.log('No videos in playlist.');
            process.exit(0);
        }

        const data = loadData();
        const existingIds = new Set(data.vods.map((v) => v.youtubeId));
        let added = 0;

        for (const item of items) {
            const videoId = item.contentDetails?.videoId || item.snippet?.resourceId?.videoId;
            if (!videoId || existingIds.has(videoId)) continue;

            const title = item.snippet?.title || 'Untitled';
            const published = item.snippet?.publishedAt?.slice(0, 10) || new Date().toISOString().slice(0, 10);

            const vod = {
                id: slugify(title) || `vod-${videoId}`,
                title,
                date: published,
                game: '',
                tags: [],
                duration: '',
                durationSeconds: 0,
                youtubeId: videoId,
                description: '',
            };
            data.vods.push(vod);
            existingIds.add(videoId);
            added++;
        }

        saveData(data);
        console.log(`\nImported ${added} VOD(s).`);
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
    console.log('Commands: add <youtube-url>, import <playlist-url>, list, edit <id>, remove <id>, stats');
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
