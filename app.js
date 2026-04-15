document.addEventListener('DOMContentLoaded', () => {
    // State Management
    let players = [];
    let serverHealth = { tps: 20, mspt: 0, players_online: 0, players_max: 0 };
    let playerHistory = [];
    let selectedPlayer = null;
    let currentSort = 'none';

    // Configuration
    const baseFirebaseURL = 'https://minecraftstats-5f79c-default-rtdb.asia-southeast1.firebasedatabase.app/';

    // DOM Elements
    const playerGrid = document.getElementById('player-grid');
    const searchInput = document.getElementById('player-search');
    const sortBySelect = document.getElementById('sort-by');
    const detailsPanel = document.getElementById('details-panel');
    const closePanelBtn = document.getElementById('close-details');
    const onlineCountLabel = document.getElementById('online-count');
    const refreshBtn = document.getElementById('btn-refresh');
    
    // View Sections
    const playersSection = document.getElementById('players-section');
    const healthSection = document.getElementById('health-section');
    
    // Health UI
    const hTPS = document.getElementById('h-tps');
    const hMSPT = document.getElementById('h-mspt');

    // Nav
    const navPlayers = document.getElementById('nav-players');
    const navLeaderboards = document.getElementById('nav-leaderboards');
    const navHealth = document.getElementById('nav-health');

    /**
     * Data Sync
     */
    async function updateAllData() {
        try {
            const [pRes, sRes, hRes] = await Promise.all([
                fetch(baseFirebaseURL + 'players.json'),
                fetch(baseFirebaseURL + 'server/health.json'),
                fetch(baseFirebaseURL + 'server/history.json')
            ]);

            const pData = await pRes.json();
            const rawPlayers = pData ? Object.values(pData) : [];
            
            // Deduplicate by Name (Smart Merge)
            const deduped = {};
            rawPlayers.forEach(p => {
                const name = p.username.toLowerCase();
                const existing = deduped[name];
                if (!existing) { deduped[name] = p; }
                else {
                    const isNewActive = p.online && !existing.online;
                    const hasMoreStats = (p.stats?.total_mined || 0) > (existing.stats?.total_mined || 0);
                    if (isNewActive || (!existing.online && hasMoreStats)) { deduped[name] = p; }
                }
            });
            players = Object.values(deduped);
            
            const sData = await sRes.json();
            if (sData) serverHealth = sData;

            const hData = await hRes.json();
            if (hData) playerHistory = Array.isArray(hData) ? hData : [];

            renderAll();
        } catch (e) {
            console.error('Quartz Dashboard Sync Error:', e);
        }
    }

    function renderAll() {
        renderPlayers();
        renderHealthStatus();
        renderTripleGraphs();

        if (selectedPlayer) {
            const updated = players.find(p => p.uuid === selectedPlayer.uuid);
            if (updated) updateDetailPanel(updated);
        }
    }

    /**
     * Rendering logic
     */
    function renderHealthStatus() {
        hTPS.textContent = serverHealth.tps.toFixed(2);
        hMSPT.textContent = serverHealth.mspt + 'ms';
        hTPS.style.color = serverHealth.tps > 18 ? 'var(--online)' : (serverHealth.tps > 15 ? 'var(--accent)' : 'var(--offline)');
        hMSPT.style.color = serverHealth.mspt < 40 ? 'var(--online)' : (serverHealth.mspt < 50 ? 'var(--accent)' : 'var(--offline)');
    }

    function renderTripleGraphs() {
        if (!playerHistory || playerHistory.length < 2) return;

        // Render each chart independently
        renderSingleChart('graph-players', 'p', Math.max(...playerHistory.map(d => d.p), 5), 'var(--player-color)', 'line-players');
        renderSingleChart('graph-tps', 't', 20, 'var(--tps-color)', 'line-tps');
        renderSingleChart('graph-mspt', 'm', Math.max(...playerHistory.map(d => d.m), 60), 'var(--mspt-color)', 'line-mspt');
    }

    function renderSingleChart(svgId, key, maxVal, color, lineClass) {
        const svg = document.getElementById(svgId);
        if (!svg) return;

        const w = svg.clientWidth;
        const h = 160;
        const count = playerHistory.length;
        const stepX = w / (count - 1);

        const getY = (val) => h - ((val / maxVal) * (h * 0.7)) - (h * 0.1);
        const path = playerHistory.map((d, i) => `${i * stepX},${getY(d[key])}`);

        svg.innerHTML = `
            <path d="M ${path.join(' L ')}" class="graph-line ${lineClass}"></path>
        `;
    }

    /**
     * Tooltip Logic for Triple Charts
     */
    function setupChartTracking(wrapperId, graphId, tooltipId, key, label, unit) {
        const wrapper = document.getElementById(wrapperId);
        const tooltip = document.getElementById(tooltipId);
        if (!wrapper || !tooltip) return;

        wrapper.addEventListener('mousemove', (e) => {
            if (!playerHistory.length) return;
            const rect = wrapper.getBoundingClientRect();
            const x = e.clientX - rect.left;
            const w = rect.width;
            const stepX = w / (playerHistory.length - 1);
            const index = Math.min(Math.max(Math.round(x / stepX), 0), playerHistory.length - 1);
            const data = playerHistory[index];
            if (!data) return;

            tooltip.style.display = 'block';
            tooltip.style.left = (x > w - 120 ? x - 130 : x + 10) + 'px';
            tooltip.style.top = '10px';

            const date = new Date(data.ts * 1000);
            const timeStr = date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

            tooltip.innerHTML = `
                <div style="font-size:9px; color:var(--text-muted); margin-bottom:4px">${timeStr}</div>
                <div style="display:flex; justify-content:space-between; gap:10px">
                    <span>${label}:</span> 
                    <strong style="color:var(--primary)">${data[key]}${unit}</strong>
                </div>
            `;
        });

        wrapper.addEventListener('mouseleave', () => { tooltip.style.display = 'none'; });
    }

    // Initialize individual tracking
    setupChartTracking('wrapper-players', 'graph-players', 'tooltip-players', 'p', 'Players', '');
    setupChartTracking('wrapper-tps', 'graph-tps', 'tooltip-tps', 't', 'TPS', '');
    setupChartTracking('wrapper-mspt', 'graph-mspt', 'tooltip-mspt', 'm', 'MSPT', 'ms');

    /**
     * Player List
     */
    function renderPlayers() {
        const searchTerm = searchInput.value.toLowerCase();
        const filtered = getSortedPlayers().filter(p => p.username.toLowerCase().includes(searchTerm));

        if (filtered.length === 0) {
            playerGrid.innerHTML = '<div class="loading-state"><p>No data records found.</p></div>';
            return;
        }

        playerGrid.innerHTML = filtered.map(player => {
            const stats = player.stats || {};
            const mined = stats.total_mined || 0;
            const timeTicks = (stats['minecraft:custom'] || {})['PLAY_ONE_MINUTE'] || 0;
            const timeHours = Math.floor(timeTicks / 20 / 60 / 60);
            const skinIdentity = player.skin || player.username; 

            return `
                <div class="player-card ${!player.online ? 'offline-card' : ''}" onclick="showPlayerDetails('${player.uuid}')">
                    <div class="p-avatar">
                        <img src="https://mc-heads.net/avatar/${skinIdentity}/80" alt="${player.username}">
                    </div>
                    <div class="p-name">${player.username}</div>
                    <div class="p-status ${player.online ? 'online' : 'offline'}">
                        <span class="status-dot"></span> ${player.online ? 'Active' : 'Offline'}
                    </div>
                    <div class="p-quick-stats">
                        <div class="stat-item"><span class="val">${timeHours}h</span><span class="lab">Played</span></div>
                        <div class="stat-item"><span class="val">${mined}</span><span class="lab">Mined</span></div>
                    </div>
                </div>
            `;
        }).join('');

        onlineCountLabel.textContent = `${players.filter(p => p.online).length}/${players.length}`;
    }

    function getSortedPlayers() {
        let sorted = [...players];
        if (currentSort === 'playtime') sorted.sort((a, b) => (b.stats?.['minecraft:custom']?.['PLAY_ONE_MINUTE'] || 0) - (a.stats?.['minecraft:custom']?.['PLAY_ONE_MINUTE'] || 0));
        else if (currentSort === 'kills') sorted.sort((a, b) => (b.stats?.['minecraft:custom']?.['PLAYER_KILLS'] || 0) - (a.stats?.['minecraft:custom']?.['PLAYER_KILLS'] || 0));
        else if (currentSort === 'mined') sorted.sort((a, b) => (b.stats?.total_mined || 0) - (a.stats?.total_mined || 0));
        else sorted.sort((a, b) => (b.online === a.online) ? a.username.localeCompare(b.username) : (b.online ? 1 : -1));
        return sorted;
    }

    /**
     * Detail Panel
     */
    window.showPlayerDetails = (uuid) => {
        const player = players.find(p => p.uuid === uuid);
        if (!player) return;
        selectedPlayer = player;
        updateDetailPanel(player);
        detailsPanel.classList.add('open');
    };

    function updateDetailPanel(player) {
        document.getElementById('detail-username').textContent = player.username;
        const skinIdentity = player.skin || player.username;
        document.getElementById('detail-avatar-body').src = `https://mc-heads.net/body/${skinIdentity}/160`;

        const stats = player.stats || {};
        const custom = stats['minecraft:custom'] || {};
        const container = document.getElementById('general-stats-container');
        
        const kills = custom['PLAYER_KILLS'] || 0;
        const deaths = custom['DEATHS'] || 0;
        const mobs = custom['MOB_KILLS'] || 0;
        const mined = stats.total_mined || 0;
        const placed = stats.total_placed || 0;
        const kd = (kills / Math.max(1, deaths)).toFixed(2);
        const playtime = Math.floor((custom['PLAY_ONE_MINUTE'] || 0) / 20 / 60 / 60) + 'h';

        let gridHtml = `
            <div class="stat-card"><span class="stat-label">Playtime</span><span class="stat-value">${playtime}</span></div>
            <div class="stat-card"><span class="stat-label">Deaths</span><span class="stat-value">${deaths}</span></div>
            <div class="stat-card"><span class="stat-label">Kills</span><span class="stat-value">${kills}</span></div>
            <div class="stat-card"><span class="stat-label">K/D</span><span class="stat-value">${kd}</span></div>
            <div class="stat-card"><span class="stat-label">Mined</span><span class="stat-value">${mined}</span></div>
            <div class="stat-card"><span class="stat-label">Placed</span><span class="stat-value">${placed}</span></div>
            <div class="stat-card"><span class="stat-label">Mob Kills</span><span class="stat-value">${mobs}</span></div>
        `;

        const featured = ['PLAY_ONE_MINUTE', 'DEATHS', 'PLAYER_KILLS', 'MOB_KILLS', 'TOTAL_MINED', 'TOTAL_PLACED'];
        Object.entries(custom).forEach(([key, val]) => {
            if (!featured.includes(key)) {
                gridHtml += `<div class="stat-card"><span class="stat-label">${formatName(key)}</span><span class="stat-value">${val}</span></div>`;
            }
        });
        container.innerHTML = gridHtml;

        renderStatChart(document.getElementById('mining-graph'), stats['minecraft:mined'] || {}, 'bar-stone');
        renderStatChart(document.getElementById('combat-graph'), stats['minecraft:killed'] || {}, 'bar-emerald');
    }

    function renderStatChart(container, dataMap, defaultClass) {
        const items = Object.entries(dataMap || {}).map(([n, c]) => ({ n, c })).sort((a, b) => b.c - a.c).slice(0, 10);
        if (items.length === 0) { container.innerHTML = '<div class="empty-msg">No entries.</div>'; return; }
        const max = Math.max(...items.map(i => i.c), 1);
        container.innerHTML = items.map(i => `
            <div class="graph-row">
                <span class="graph-label">${formatName(i.n)}</span>
                <div class="bar-container"><div class="bar-fill ${getContextClass(i.n, defaultClass)}" style="width: ${(i.c/max)*100}%"></div></div>
                <span class="graph-value">${i.c}</span>
            </div>`).join('');
    }

    function formatName(raw) { return raw.toLowerCase().replace(/minecraft:/g, '').split('_').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' '); }
    function getContextClass(n, d) { return n.includes('DIAMOND') ? 'bar-diamond' : (n.includes('GOLD') ? 'bar-gold' : (n.includes('IRON') ? 'bar-iron' : d)); }

    function switchTab(tab) {
        navPlayers.classList.remove('active');
        navLeaderboards.classList.remove('active');
        navHealth.classList.remove('active');
        playersSection.style.display = 'none';
        healthSection.style.display = 'none';
        if (tab === 'players') { navPlayers.classList.add('active'); playersSection.style.display = 'block'; }
        else if (tab === 'leaderboard') { navLeaderboards.classList.add('active'); playersSection.style.display = 'block'; currentSort = 'mined'; sortBySelect.value = 'mined'; renderPlayers(); }
        else if (tab === 'health') { navHealth.classList.add('active'); healthSection.style.display = 'block'; setTimeout(renderTripleGraphs, 100); }
    }

    navPlayers.addEventListener('click', () => switchTab('players'));
    navLeaderboards.addEventListener('click', () => switchTab('leaderboard'));
    navHealth.addEventListener('click', () => switchTab('health'));
    closePanelBtn.addEventListener('click', () => { detailsPanel.classList.remove('open'); selectedPlayer = null; });
    sortBySelect.addEventListener('change', (e) => { currentSort = e.target.value; renderPlayers(); });
    refreshBtn.addEventListener('click', updateAllData);

    updateAllData();
    setInterval(updateAllData, 30000);
});
