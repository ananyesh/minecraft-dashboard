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
    
    // General Containers
    const playersSection = document.getElementById('players-section');
    const healthSection = document.getElementById('health-section');
    
    // Health Elements
    const hTPS = document.getElementById('h-tps');
    const hMSPT = document.getElementById('h-mspt');
    const historyGraph = document.getElementById('history-graph');

    // Nav
    const navPlayers = document.getElementById('nav-players');
    const navLeaderboards = document.getElementById('nav-leaderboards');
    const navHealth = document.getElementById('nav-health');

    /**
     * Fetch all data from Firebase
     */
    async function updateAllData() {
        try {
            // 1. Fetch Players
            const pRes = await fetch(baseFirebaseURL + 'players.json');
            const pData = await pRes.json();
            players = pData ? Object.values(pData) : [];
            
            // 2. Fetch Server Health
            const sRes = await fetch(baseFirebaseURL + 'server/health.json');
            const sData = await sRes.json();
            if (sData) serverHealth = sData;

            // 3. Fetch History
            const hRes = await fetch(baseFirebaseURL + 'server/history.json');
            const hData = await hRes.json();
            if (hData) playerHistory = hData;

            renderAll();
        } catch (e) {
            console.error('Fetch Error:', e);
        }
    }

    function renderAll() {
        renderPlayers();
        renderHealthStatus();
        renderHistoryGraph();

        // Refresh detail panel if open
        if (selectedPlayer) {
            const updated = players.find(p => p.uuid === selectedPlayer.uuid);
            if (updated) showPlayerDetails(updated.uuid);
        }
    }

    /**
     * Rendering logic
     */
    function renderHealthStatus() {
        hTPS.textContent = serverHealth.tps.toFixed(2);
        hMSPT.textContent = serverHealth.mspt + 'ms';
        
        // Color coding
        hTPS.style.color = serverHealth.tps > 18 ? 'var(--online)' : (serverHealth.tps > 15 ? 'var(--accent)' : 'var(--offline)');
        hMSPT.style.color = serverHealth.mspt < 40 ? 'var(--online)' : (serverHealth.mspt < 50 ? 'var(--accent)' : 'var(--offline)');
    }

    function renderHistoryGraph() {
        if (!playerHistory || playerHistory.length < 2) return;

        const width = historyGraph.clientWidth || 800;
        const height = 200;
        const maxPlayers = Math.max(...playerHistory, 5);
        
        // Points Calculation
        const stepX = width / (playerHistory.length - 1);
        const points = playerHistory.map((count, i) => {
            const x = i * stepX;
            const y = height - (count / maxPlayers) * (height - 40) - 20;
            return `${x},${y}`;
        });

        const dLine = `M ${points.join(' L ')}`;
        const dArea = `${dLine} L ${width},${height} L 0,${height} Z`;

        historyGraph.innerHTML = `
            <defs>
                <linearGradient id="gradient" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stop-color="var(--primary)" stop-opacity="0.3"/>
                    <stop offset="100%" stop-color="var(--primary)" stop-opacity="0"/>
                </linearGradient>
            </defs>
            <path d="${dArea}" class="graph-area"></path>
            <path d="${dLine}" class="graph-path"></path>
        `;
    }

    function renderPlayers() {
        const searchTerm = searchInput.value.toLowerCase();
        const sorted = getSortedPlayers();
        const filtered = sorted.filter(p => p.username.toLowerCase().includes(searchTerm));

        playerGrid.innerHTML = filtered.map(player => {
            const playtimeHours = Math.floor((player.stats['minecraft:custom']['PLAY_ONE_MINUTE'] || 0) / 20 / 60 / 60);
            const totalMined = Object.values(player.stats['minecraft:mined'] || {}).reduce((s, v) => s + v, 0);

            return `
                <div class="player-card ${!player.online ? 'offline-card' : ''}" onclick="showPlayerDetails('${player.uuid}')">
                    <div class="p-avatar">
                        <img src="https://mc-heads.net/avatar/${player.uuid}/80" alt="${player.username}">
                    </div>
                    <div class="p-name">${player.username}</div>
                    <div class="p-status ${player.online ? 'online' : 'offline'}">
                        ${player.online ? 'Online' : 'Offline'}
                    </div>
                    <div class="p-quick-stats">
                        <div class="stat-item">
                            <span class="val">${playtimeHours}h</span>
                            <span class="lab">Playtime</span>
                        </div>
                        <div class="stat-item">
                            <span class="val">${totalMined}</span>
                            <span class="lab">Mined</span>
                        </div>
                    </div>
                </div>
            `;
        }).join('');

        onlineCountLabel.textContent = `${players.filter(p => p.online).length}/${players.length}`;
    }

    function getSortedPlayers() {
        let sorted = [...players];
        if (currentSort === 'playtime') sorted.sort((a, b) => (b.stats['minecraft:custom']['PLAY_ONE_MINUTE'] || 0) - (a.stats['minecraft:custom']['PLAY_ONE_MINUTE'] || 0));
        else if (currentSort === 'kills') sorted.sort((a, b) => (b.stats['minecraft:custom']['PLAYER_KILLS'] || 0) - (a.stats['minecraft:custom']['PLAYER_KILLS'] || 0));
        else if (currentSort === 'deaths') sorted.sort((a, b) => (b.stats['minecraft:custom']['DEATHS'] || 0) - (a.stats['minecraft:custom']['DEATHS'] || 0));
        else if (currentSort === 'mined') sorted.sort((a, b) => {
            const tA = Object.values(a.stats['minecraft:mined'] || {}).reduce((s, v) => s + v, 0);
            const tB = Object.values(b.stats['minecraft:mined'] || {}).reduce((s, v) => s + v, 0);
            return tB - tA;
        });
        else sorted.sort((a, b) => (b.online === a.online) ? a.username.localeCompare(b.username) : (b.online ? 1 : -1));
        return sorted;
    }

    window.showPlayerDetails = (uuid) => {
        const player = players.find(p => p.uuid === uuid);
        if (!player) return;
        selectedPlayer = player;

        detailUsername.textContent = player.username;
        detailAvatar.src = `https://mc-heads.net/body/${player.uuid}/160`;

        // Render ALL General Stats
        const custom = player.stats['minecraft:custom'] || {};
        const generalContainer = document.getElementById('general-stats-container');
        
        // Featured ones first
        const playtimeTicks = custom['PLAY_ONE_MINUTE'] || 0;
        statPlaytime.textContent = `${Math.floor(playtimeTicks / 20 / 60 / 60)}h`;
        statDeaths.textContent = custom['DEATHS'] || 0;
        statKills.textContent = custom['PLAYER_KILLS'] || 0;
        statMobKills.textContent = custom['MOB_KILLS'] || 0;
        statKD.textContent = (custom['PLAYER_KILLS'] / Math.max(1, custom['DEATHS'])).toFixed(2);

        const mined = player.stats['minecraft:mined'] || {};
        statMined.textContent = Object.values(mined).reduce((s, v) => s + v, 0);
        statDiamonds.textContent = (mined['DIAMOND_ORE'] || 0) + (mined['DEEPSLATE_DIAMOND_ORE'] || 0);

        // Inject ALL other general stats
        const excluded = ['PLAY_ONE_MINUTE', 'DEATHS', 'PLAYER_KILLS', 'MOB_KILLS'];
        let extraHtml = '';
        Object.entries(custom).forEach(([key, val]) => {
            if (!excluded.includes(key)) {
                extraHtml += `<div class="stat-card"><span class="stat-label">${formatName(key)}</span><span class="stat-value">${val}</span></div>`;
            }
        });
        generalContainer.innerHTML = `
            <div class="stat-card"><span class="stat-label">Playtime</span><span class="stat-value">${statPlaytime.textContent}</span></div>
            <div class="stat-card"><span class="stat-label">Deaths</span><span class="stat-value">${statDeaths.textContent}</span></div>
            ${extraHtml}
        `;

        renderStatChart(miningGraph, mined, 'bar-stone');
        renderStatChart(combatGraph, player.stats['minecraft:killed'] || {}, 'bar-emerald');
        detailsPanel.classList.add('open');
    };

    function renderStatChart(container, dataMap, defaultClass) {
        const items = Object.entries(dataMap || {}).map(([n, c]) => ({ n, c })).sort((a, b) => b.c - a.c).slice(0, 10);
        if (items.length === 0) { container.innerHTML = '<div class="empty-msg">No data.</div>'; return; }
        const max = Math.max(...items.map(i => i.c), 1);
        container.innerHTML = items.map(i => `<div class="graph-row"><span class="graph-label">${formatName(i.n)}</span><div class="bar-container"><div class="bar-fill ${getContextClass(i.n, defaultClass)}" style="width: ${(i.c/max)*100}%"></div></div><span class="graph-value">${i.c}</span></div>`).join('');
    }

    function formatName(raw) { return raw.toLowerCase().replace(/minecraft:/g, '').split('_').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' '); }
    function getContextClass(n, d) { return n.includes('DIAMOND') ? 'bar-diamond' : (n.includes('GOLD') ? 'bar-gold' : (n.includes('IRON') ? 'bar-iron' : d)); }

    // Navigation Logic
    function switchTab(tab) {
        navPlayers.classList.remove('active');
        navLeaderboards.classList.remove('active');
        navHealth.classList.remove('active');
        playersSection.style.display = 'none';
        healthSection.style.display = 'none';

        if (tab === 'players') {
            navPlayers.classList.add('active');
            playersSection.style.display = 'block';
        } else if (tab === 'leaderboard') {
            navLeaderboards.classList.add('active');
            playersSection.style.display = 'block';
            currentSort = 'mined';
            sortBySelect.value = 'mined';
            renderPlayers();
        } else if (tab === 'health') {
            navHealth.classList.add('active');
            healthSection.style.display = 'block';
            setTimeout(renderHistoryGraph, 100); // Trigger graph redraw
        }
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
