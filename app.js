/**
 * VOD Archive - Search, filter, and player logic
 */
(function () {
    'use strict';

    const DATA_URL = 'data/vods.json';
    let allVods = [];
    let filteredVods = [];
    let fuse = null;
    let player = null;
    let currentModalIndex = -1;

    // DOM elements
    const elements = {
        searchInput: document.getElementById('search-input'),
        searchClear: document.getElementById('search-clear'),
        filterGame: document.getElementById('filter-game'),
        filterSort: document.getElementById('filter-sort'),
        filterDateFrom: document.getElementById('filter-date-from'),
        filterDateTo: document.getElementById('filter-date-to'),
        filterTags: document.getElementById('filter-tags'),
        vodGrid: document.getElementById('vod-grid'),
        noResults: document.getElementById('no-results'),
        resultsCount: document.getElementById('results-count'),
        clearFilters: document.getElementById('clear-filters'),
        statTotal: document.getElementById('stat-total'),
        statHours: document.getElementById('stat-hours'),
        statGames: document.getElementById('stat-games'),
        modal: document.getElementById('player-modal'),
        modalClose: document.getElementById('modal-close'),
        modalTitle: document.getElementById('modal-title'),
        modalGame: document.querySelector('.modal-game'),
        modalDate: document.querySelector('.modal-date'),
        modalDuration: document.querySelector('.modal-duration'),
        modalDescription: document.querySelector('.modal-description'),
        modalTags: document.getElementById('modal-tags'),
        modalPrev: document.getElementById('modal-prev'),
        modalNext: document.getElementById('modal-next'),
    };

    /**
     * Format duration seconds to HH:MM:SS or MM:SS
     */
    function formatDuration(seconds) {
        const h = Math.floor(seconds / 3600);
        const m = Math.floor((seconds % 3600) / 60);
        const s = Math.floor(seconds % 60);
        if (h > 0) {
            return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
        }
        return `${m}:${String(s).padStart(2, '0')}`;
    }

    /**
     * Format date for display
     */
    function formatDate(dateStr) {
        const d = new Date(dateStr + 'T00:00:00');
        return d.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
    }

    /**
     * Format date for input[type="date"]
     */
    function toInputDate(dateStr) {
        return dateStr || '';
    }

    /**
     * Extract YouTube video ID from URL
     */
    function getYoutubeId(url) {
        if (!url) return null;
        const match = url.match(/(?:youtube\.com\/(?:[^/]+\/.+\/|(?:v|e(?:mbed)?)\/|.*[?&]v=)|youtu\.be\/)([^"&?/\s]{11})/);
        return match ? match[1] : null;
    }

    /**
     * Load VOD data (server proxies from remote, falls back to local)
     */
    async function loadData() {
        try {
            const res = await fetch(DATA_URL);
            if (!res.ok) throw new Error(res.status);
            const data = await res.json();
            allVods = data.vods || [];
            initFuse();
            updateStats();
            populateFilters();
            render();
            syncFromUrl();
            bindEvents();
        } catch (err) {
            console.error('Failed to load VOD data:', err);
            elements.vodGrid.innerHTML = '<p class="no-results">Failed to load VOD data. Check your internet connection or try again later.</p>';
        }
    }

    /**
     * Initialize Fuse.js for fuzzy search
     */
    function initFuse() {
        fuse = new Fuse(allVods, {
            keys: ['title', 'game', 'description', 'tags'],
            threshold: 0.3,
        });
    }

    /**
     * Update stats bar
     */
    function updateStats() {
        const totalHours = allVods.reduce((sum, v) => sum + (v.durationSeconds || 0), 0) / 3600;
        const games = [...new Set(allVods.map((v) => v.game).filter(Boolean))];
        elements.statTotal.textContent = allVods.length;
        elements.statHours.textContent = totalHours.toFixed(1);
        elements.statGames.textContent = games.length;
    }

    /**
     * Populate filter dropdowns and tag pills
     */
    function populateFilters() {
        const games = [...new Set(allVods.map((v) => v.game).filter(Boolean))].sort();
        const tags = [...new Set(allVods.flatMap((v) => v.tags || []))].sort();

        elements.filterGame.innerHTML = '<option value="">All games</option>' +
            games.map((g) => `<option value="${escapeHtml(g)}">${escapeHtml(g)}</option>`).join('');

        elements.filterTags.innerHTML = tags.map((t) =>
            `<button type="button" class="tag-pill" data-tag="${escapeHtml(t)}">${escapeHtml(t)}</button>`
        ).join('');
    }

    function escapeHtml(str) {
        const div = document.createElement('div');
        div.textContent = str;
        return div.innerHTML;
    }

    /**
     * Apply filters and search, return filtered list
     */
    function getFilteredList() {
        let list = allVods;

        // Search
        const query = (elements.searchInput.value || '').trim();
        if (query && fuse) {
            const results = fuse.search(query);
            list = results.map((r) => r.item);
        }

        // Game filter
        const game = elements.filterGame.value;
        if (game) {
            list = list.filter((v) => v.game === game);
        }

        // Date range
        const dateFrom = elements.filterDateFrom.value;
        const dateTo = elements.filterDateTo.value;
        if (dateFrom) {
            list = list.filter((v) => v.date >= dateFrom);
        }
        if (dateTo) {
            list = list.filter((v) => v.date <= dateTo);
        }

        // Tag filter (active pills)
        const activeTags = [...elements.filterTags.querySelectorAll('.tag-pill.active')].map((p) => p.dataset.tag);
        if (activeTags.length > 0) {
            list = list.filter((v) => (v.tags || []).some((t) => activeTags.includes(t)));
        }

        // Sort
        const sort = elements.filterSort.value;
        list = [...list.sort((a, b) => {
            switch (sort) {
                case 'oldest':
                    return (a.date || '').localeCompare(b.date || '');
                case 'longest':
                    return (b.durationSeconds || 0) - (a.durationSeconds || 0);
                case 'shortest':
                    return (a.durationSeconds || 0) - (b.durationSeconds || 0);
                case 'title':
                    return (a.title || '').localeCompare(b.title || '');
                case 'newest':
                default:
                    return (b.date || '').localeCompare(a.date || '');
            }
        })];

        return list;
    }

    /**
     * Render VOD grid
     */
    function render() {
        filteredVods = getFilteredList();

        elements.resultsCount.textContent = `${filteredVods.length} VOD${filteredVods.length !== 1 ? 's' : ''}`;
        elements.noResults.hidden = filteredVods.length > 0;
        elements.vodGrid.hidden = filteredVods.length === 0;

        elements.vodGrid.innerHTML = filteredVods.map((vod, index) => {
            const thumbUrl = `https://img.youtube.com/vi/${vod.youtubeId || 'dQw4w9WgXcQ'}/maxresdefault.jpg`;
            const fallbackUrl = `https://img.youtube.com/vi/${vod.youtubeId || 'dQw4w9WgXcQ'}/hqdefault.jpg`;
            const duration = vod.duration || formatDuration(vod.durationSeconds || 0);
            return `
                <article class="vod-card" data-index="${index}" data-id="${escapeHtml(vod.id)}">
                    <div class="vod-card-thumb">
                        <img src="${thumbUrl}" alt="" onerror="this.src='${fallbackUrl}'" loading="lazy">
                        <span class="vod-card-duration">${escapeHtml(duration)}</span>
                    </div>
                    <div class="vod-card-body">
                        <h3 class="vod-card-title">${escapeHtml(vod.title)}</h3>
                        <div class="vod-card-meta">
                            ${vod.game ? `<span class="vod-card-game">${escapeHtml(vod.game)}</span>` : ''}
                            <span>${escapeHtml(formatDate(vod.date))}</span>
                        </div>
                    </div>
                </article>
            `;
        }).join('');
    }

    /**
     * Open modal and play video
     */
    function openModal(index) {
        if (index < 0 || index >= filteredVods.length) return;
        currentModalIndex = index;
        const vod = filteredVods[index];

        elements.modalTitle.textContent = vod.title;
        elements.modalGame.textContent = vod.game ? `Game: ${vod.game}` : '';
        elements.modalDate.textContent = vod.date ? formatDate(vod.date) : '';
        elements.modalDuration.textContent = vod.duration || formatDuration(vod.durationSeconds || 0);
        elements.modalDescription.textContent = vod.description || '';
        elements.modalTags.innerHTML = (vod.tags || []).map((t) =>
            `<span class="modal-tag">${escapeHtml(t)}</span>`
        ).join('');

        elements.modalPrev.disabled = index === 0;
        elements.modalNext.disabled = index === filteredVods.length - 1;

        elements.modal.hidden = false;
        document.body.style.overflow = 'hidden';

        if (typeof YT !== 'undefined' && YT.Player) {
            initPlayer(vod.youtubeId);
        } else {
            window.onYouTubeIframeAPIReady = () => initPlayer(vod.youtubeId);
        }

        syncToUrl(vod.id);
    }

    function initPlayer(youtubeId) {
        const container = document.getElementById('youtube-player');
        container.innerHTML = '';
        if (player) {
            player.destroy();
        }
        player = new YT.Player('youtube-player', {
            height: '100%',
            width: '100%',
            videoId: youtubeId || 'dQw4w9WgXcQ',
            playerVars: {
                autoplay: 1,
                enablejsapi: 1,
            },
        });
    }

    function closeModal() {
        elements.modal.hidden = true;
        document.body.style.overflow = '';
        if (player) {
            player.destroy();
            player = null;
        }
        syncToUrl(null);
    }

    /**
     * URL state: ?vod=id or ?game=...
     */
    function syncToUrl(vodId) {
        const params = new URLSearchParams(window.location.search);
        if (vodId) {
            params.set('vod', vodId);
        } else {
            params.delete('vod');
        }
        const newUrl = params.toString() ? `${window.location.pathname}?${params}` : window.location.pathname;
        window.history.replaceState({}, '', newUrl);
    }

    function syncFromUrl() {
        const params = new URLSearchParams(window.location.search);
        const game = params.get('game');
        if (game) {
            elements.filterGame.value = game;
        }
        const q = params.get('q');
        if (q) {
            elements.searchInput.value = q;
        }
        render();
        const vodId = params.get('vod');
        if (vodId) {
            const idx = filteredVods.findIndex((v) => v.id === vodId);
            if (idx >= 0) {
                openModal(idx);
            }
        }
    }

    /**
     * Update URL with current filter state
     */
    function updateUrl() {
        const params = new URLSearchParams();
        const game = elements.filterGame.value;
        if (game) params.set('game', game);
        const q = elements.searchInput.value.trim();
        if (q) params.set('q', q);
        const newUrl = params.toString() ? `${window.location.pathname}?${params}` : window.location.pathname;
        window.history.replaceState({}, '', newUrl);
    }

    /**
     * Bind event listeners
     */
    function bindEvents() {
        elements.searchInput.addEventListener('input', () => {
            render();
            updateUrl();
        });

        elements.searchClear.addEventListener('click', () => {
            elements.searchInput.value = '';
            elements.searchInput.focus();
            render();
            updateUrl();
        });

        elements.filterGame.addEventListener('change', () => { render(); updateUrl(); });
        elements.filterSort.addEventListener('change', () => { render(); updateUrl(); });
        elements.filterDateFrom.addEventListener('change', () => { render(); updateUrl(); });
        elements.filterDateTo.addEventListener('change', () => { render(); updateUrl(); });

        elements.filterTags.addEventListener('click', (e) => {
            const pill = e.target.closest('.tag-pill');
            if (pill) {
                pill.classList.toggle('active');
                render();
                updateUrl();
            }
        });

        elements.clearFilters.addEventListener('click', () => {
            elements.searchInput.value = '';
            elements.filterGame.value = '';
            elements.filterSort.value = 'newest';
            elements.filterDateFrom.value = '';
            elements.filterDateTo.value = '';
            elements.filterTags.querySelectorAll('.tag-pill.active').forEach((p) => p.classList.remove('active'));
            render();
            window.history.replaceState({}, '', window.location.pathname);
        });

        elements.vodGrid.addEventListener('click', (e) => {
            const card = e.target.closest('.vod-card');
            if (card) {
                const index = parseInt(card.dataset.index, 10);
                openModal(index);
            }
        });

        elements.modalClose.addEventListener('click', closeModal);
        elements.modal.querySelector('.modal-backdrop').addEventListener('click', closeModal);

        elements.modalPrev.addEventListener('click', () => {
            if (currentModalIndex > 0) {
                openModal(currentModalIndex - 1);
            }
        });

        elements.modalNext.addEventListener('click', () => {
            if (currentModalIndex < filteredVods.length - 1) {
                openModal(currentModalIndex + 1);
            }
        });

        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') closeModal();
            if (elements.modal.hidden) return;
            if (e.key === 'ArrowLeft') elements.modalPrev.click();
            if (e.key === 'ArrowRight') elements.modalNext.click();
        });
    }

    // Load YouTube IFrame API
    const tag = document.createElement('script');
    tag.src = 'https://www.youtube.com/iframe_api';
    const firstScriptTag = document.getElementsByTagName('script')[0];
    firstScriptTag.parentNode.insertBefore(tag, firstScriptTag);

    window.onYouTubeIframeAPIReady = function () {
        // API ready; player will be created when modal opens
    };

    loadData();
})();
