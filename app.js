document.addEventListener('DOMContentLoaded', () => {
    // State Management
    let players = [];
    let serverHealth = { tps: 20, mspt: 0, players_online: 0, players_max: 0 };
    let playerHistory = [];
    let selectedPlayer = null;
    let currentSort = 'none';
    let currentTab = 'players';
    let tpsOdo = null;
    let msptOdo = null;
    let playersOdo = null;
    const statCache = {}; // { uuid_statKey: lastValue } for odometer prev->new animation

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
            const [pRes, sRes, hRes] = await Promise.allSettled([
                fetch(baseFirebaseURL + 'players.json'),
                fetch(baseFirebaseURL + 'server/health.json'),
                fetch(baseFirebaseURL + 'server/history.json')
            ]);

            if (pRes.status === 'fulfilled') {
                const pData = await pRes.value.json();
                const rawPlayers = pData ? Object.values(pData).filter(p => p && p.username) : [];
                const deduped = {};
                rawPlayers.forEach(p => {
                    const name = p.username.toLowerCase();
                    const existing = deduped[name];
                    if (!existing || (p.online && !existing.online) || (p.stats?.total_mined > (existing.stats?.total_mined || 0))) {
                        deduped[name] = p;
                    }
                });
                players = Object.values(deduped);
            }
            
            if (sRes.status === 'fulfilled') {
                try {
                    const sData = await sRes.value.json();
                    if (sData) serverHealth = sData;
                } catch(e) {}
            }

            if (hRes.status === 'fulfilled') {
                try {
                    const hData = await hRes.value.json();
                    if (hData) playerHistory = Array.isArray(hData) ? hData : [];
                } catch(e) {}
            }
        } catch (e) {
            console.error('Quartz Dashboard Sync Error:', e);
        } finally {
            renderAll();
        }
    }

    function renderAll() {
        if (currentTab === 'players') renderPlayersGrid();
        else if (currentTab === 'leaderboard') renderLeaderboard();
        
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
        const tps = serverHealth.tps || 20;
        const mspt = serverHealth.mspt || 0;

        const tpsEl = document.getElementById('h-tps');
        const msptEl = document.getElementById('h-mspt');

        // Initialize Odometers on first render
        if (typeof Odometer !== 'undefined') {
            if (!tpsOdo && tpsEl) {
                tpsOdo = new Odometer({ el: tpsEl, value: tps, format: 'd', theme: 'minimal', duration: 800 });
            }
            if (!msptOdo && msptEl) {
                msptOdo = new Odometer({ el: msptEl, value: mspt, format: 'd', theme: 'minimal', duration: 800 });
            }
            // Update values (animate)
            if (tpsOdo) tpsOdo.update(Math.round(tps));
            if (msptOdo) msptOdo.update(Math.round(mspt));
        } else {
            // Fallback if odometer.js didn't load
            if (tpsEl) tpsEl.textContent = tps.toFixed(1);
            if (msptEl) msptEl.textContent = Math.round(mspt);
        }

        // Color coding - TPS
        if (tpsEl) tpsEl.style.color = tps > 18 ? 'var(--online)' : (tps > 15 ? 'var(--accent)' : 'var(--offline)');
        // Color coding - MSPT (4-tier traffic light)
        if (msptEl) {
            if (mspt > 50)        msptEl.style.color = '#ef4444'; // Red
            else if (mspt > 37.5) msptEl.style.color = '#f97316'; // Orange 
            else if (mspt > 25)   msptEl.style.color = '#eab308'; // Yellow
            else if (mspt > 12.5) msptEl.style.color = '#fef08a'; // Light yellow
            else                  msptEl.style.color = '#22c55e'; // Bright green
        }

        // Players Online card
        const playersEl = document.getElementById('h-players');
        const onlineCount = players.filter(p => p.online).length;
        if (typeof Odometer !== 'undefined' && playersEl) {
            if (!playersOdo) {
                playersOdo = new Odometer({ el: playersEl, value: 0, format: 'd', theme: 'minimal', duration: 800 });
            }
            playersOdo.update(onlineCount);
        } else if (playersEl) {
            playersEl.textContent = onlineCount;
        }
    }

    function renderTripleGraphs() {
        if (!playerHistory || playerHistory.length < 2) return;
        renderSingleChart('graph-players', 'p', Math.max(...playerHistory.map(d => d.p || 0), 5), 'var(--player-color)', 'line-players');
        renderSingleChart('graph-tps', 't', 20, 'var(--tps-color)', 'line-tps');
        renderSingleChart('graph-mspt', 'm', Math.max(...playerHistory.map(d => d.m || 0), 60), 'var(--mspt-color)', 'line-mspt');
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
        svg.innerHTML = `<path d="M ${path.join(' L ')}" class="graph-line ${lineClass}"></path>`;
    }

    function setupChartTracking(wrapperId, graphId, tooltipId, key, label, unit) {
        const wrapper = document.getElementById(wrapperId);
        const tooltip = document.getElementById(tooltipId);
        if (!wrapper || !tooltip) return;
        wrapper.addEventListener('mousemove', (e) => {
            if (!playerHistory.length) return;
            const rect = wrapper.getBoundingClientRect();
            const x = e.clientX - rect.left;
            const stepX = rect.width / (playerHistory.length - 1);
            const index = Math.min(Math.max(Math.round(x / stepX), 0), playerHistory.length - 1);
            const data = playerHistory[index];
            if (!data) return;
            tooltip.style.display = 'block';
            tooltip.style.left = (x > rect.width - 120 ? x - 130 : x + 10) + 'px';
            tooltip.style.top = '10px';
            const date = new Date(data.ts * 1000);
            const timeStr = date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
            tooltip.innerHTML = `<div style="font-size:9px; color:var(--text-muted); mb:4px">${timeStr}</div><div style="display:flex; justify-content:space-between"><span>${label}:</span> <strong style="color:var(--primary)">${data[key]}${unit}</strong></div>`;
        });
        wrapper.addEventListener('mouseleave', () => { tooltip.style.display = 'none'; });
    }

    setupChartTracking('wrapper-players', 'graph-players', 'tooltip-players', 'p', 'Players', '');
    setupChartTracking('wrapper-tps', 'graph-tps', 'tooltip-tps', 't', 'TPS', '');
    setupChartTracking('wrapper-mspt', 'graph-mspt', 'tooltip-mspt', 'm', 'MSPT', 'ms');

    /**
     * Player Tab: Grid View
     */
    function renderPlayersGrid() {
        const searchTerm = searchInput.value.toLowerCase();
        const filtered = getSortedPlayers().filter(p => p.username.toLowerCase().includes(searchTerm));
        if (filtered.length === 0) { playerGrid.innerHTML = '<div class="loading-state"><p>No data found.</p></div>'; return; }

        playerGrid.innerHTML = filtered.map(player => {
            const stats = player.stats || {};
            const skinIdentity = player.skin || player.username; 
            
            // Dynamic Metric Logic
            let m1Val = 0, m1Label = 'Played', m2Val = 0, m2Label = 'Mined';
            const custom = stats['minecraft:custom'] || {};
            
            if (currentSort === 'kills') {
                m1Val = custom['PLAYER_KILLS'] || 0; m1Label = 'Kills';
                m2Val = ((custom['PLAYER_KILLS'] || 0) / Math.max(1, custom['DEATHS'] || 0)).toFixed(1); m2Label = 'K/D';
            } else if (currentSort === 'playtime') {
                m1Val = Math.floor((custom['PLAY_ONE_MINUTE'] || 0) / 20 / 60 / 60) + 'h'; m1Label = 'Played';
                m2Val = stats.total_mined || 0; m2Label = 'Mined';
            } else if (currentSort === 'mined') {
                m1Val = stats.total_mined || 0; m1Label = 'Mined';
                m2Val = stats.total_placed || 0; m2Label = 'Placed';
            } else {
                m1Val = Math.floor((custom['PLAY_ONE_MINUTE'] || 0) / 20 / 60 / 60) + 'h';
                m2Val = stats.total_mined || 0;
            }

            return `
                <div class="player-card ${!player.online ? 'offline-card' : ''}" onclick="showPlayerDetails('${player.uuid}')">
                    <div class="p-avatar"><img src="https://mc-heads.net/avatar/${skinIdentity}/80" alt="${player.username}"></div>
                    <div class="p-name">${player.username}</div>
                    <div class="p-status ${player.online ? 'online' : 'offline'}">
                        <span class="status-dot"></span> ${player.online ? 'Active' : 'Offline'}
                    </div>
                    <div class="p-quick-stats">
                        <div class="stat-item"><span class="val">${m1Val}</span><span class="lab">${m1Label}</span></div>
                        <div class="stat-item"><span class="val">${m2Val}</span><span class="lab">${m2Label}</span></div>
                    </div>
                    <div class="p-rank-badge" style="color:${getRank(calculateElo(player)).color};border-color:${getRank(calculateElo(player)).color}44;background:${getRank(calculateElo(player)).color}11">
                        ${getRank(calculateElo(player)).icon} ${getRank(calculateElo(player)).name}
                    </div>
                </div>`;
        }).join('');
        onlineCountLabel.textContent = `${players.filter(p => p.online).length}/${players.length}`;
    }

    /**
     * Leaderboard Tab: Ranked List View
     */
    function renderLeaderboard() {
        const sorted = getSortedPlayers();
        if (sorted.length === 0) { playerGrid.innerHTML = '<div class="loading-state"><p>No competition data yet.</p></div>'; return; }

        let html = '<div class="leaderboard-list">';
        html += sorted.map((player, index) => {
            const rank = index + 1;
            const stats = player.stats || {};
            const custom = stats['minecraft:custom'] || {};
            const skinIdentity = player.skin || player.username;
            
            const elo = calculateElo(player);
            const eloRank = getRank(elo);

            let displayVal = elo, displayLabel = 'ELO';
            if (currentSort === 'kills') { displayVal = custom['PLAYER_KILLS'] || 0; displayLabel = 'Kills'; }
            else if (currentSort === 'playtime') { displayVal = Math.floor((custom['PLAY_ONE_MINUTE'] || 0) / 20 / 60 / 60) + 'h'; displayLabel = 'Playtime'; }
            else if (currentSort === 'mined') { displayVal = stats.total_mined || 0; displayLabel = 'Mined'; }

            return `
                <div class="leader-row rank-pos-${rank}" onclick="showPlayerDetails('${player.uuid}')" style="border-color:${eloRank.color}33; border-left:3px solid ${eloRank.color}">
                    <div class="rank-number" style="color:${eloRank.color}">${rank}</div>
                    <div class="leader-avatar"><img src="https://mc-heads.net/avatar/${skinIdentity}/42" alt="${player.username}"></div>
                    <div class="leader-info">
                        <div style="display:flex;align-items:center;gap:8px">
                            <span class="leader-name">${player.username}</span>
                            <span class="elo-rank-pill" style="color:${eloRank.color};border-color:${eloRank.color}44;background:${eloRank.color}11">${eloRank.icon} ${eloRank.name}</span>
                        </div>
                        <span class="leader-status">${player.online ? '● Active' : '○ Offline'}</span>
                    </div>
                    <div class="leader-metric">
                        <span class="m-val" style="color:${currentSort === 'none' ? eloRank.color : 'var(--primary)'}">${displayVal}</span>
                        <span class="m-lab">${displayLabel}</span>
                    </div>
                </div>`;
        }).join('');
        html += '</div>';
        playerGrid.innerHTML = html;
        onlineCountLabel.textContent = `${players.filter(p => p.online).length}/${players.length}`;
    }

    function calculateElo(player) {
        const custom = player.stats?.['minecraft:custom'] || {};
        const killedBy = player.stats?.['minecraft:killed_by'] || {};
        const kills = custom['PLAYER_KILLS'] || 0;
        const hours = Math.floor((custom['PLAY_ONE_MINUTE'] || 0) / 20 / 60 / 60);
        const pvpDeaths = killedBy['minecraft:player'] || killedBy['player'] || 0;
        return Math.max(0, (kills * 100) + (hours * 25) - (pvpDeaths * 75));
    }

    function getRank(elo) {
        if (elo >= 3000) return { name: 'Netherite', color: '#9D84CD', icon: '🖤' };
        if (elo >= 1500) return { name: 'Diamond',   color: '#7BFCFF', icon: '💎' };
        if (elo >= 700)  return { name: 'Emerald',   color: '#44E880', icon: '💚' };
        if (elo >= 300)  return { name: 'Gold',      color: '#FFD700', icon: '🥇' };
        if (elo >= 100)  return { name: 'Iron',      color: '#C8C8C8', icon: '⚙️' };
        return              { name: 'Dirt',       color: '#A0714A', icon: '🟫' };
    }

    function getSortedPlayers() {
        let sorted = [...players];
        if (currentSort === 'playtime') sorted.sort((a, b) => (b.stats?.['minecraft:custom']?.['PLAY_ONE_MINUTE'] || 0) - (a.stats?.['minecraft:custom']?.['PLAY_ONE_MINUTE'] || 0));
        else if (currentSort === 'kills') sorted.sort((a, b) => (b.stats?.['minecraft:custom']?.['PLAYER_KILLS'] || 0) - (a.stats?.['minecraft:custom']?.['PLAYER_KILLS'] || 0));
        else if (currentSort === 'mined') sorted.sort((a, b) => (b.stats?.total_mined || 0) - (a.stats?.total_mined || 0));
        else sorted.sort((a, b) => calculateElo(b) - calculateElo(a));
        return sorted;
    }

    /**
     * Detail Panel Logic
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
        
        const kills = custom['PLAYER_KILLS'] || 0, deaths = custom['DEATHS'] || 0, mobs = custom['MOB_KILLS'] || 0;
        const mined = stats.total_mined || 0, placed = stats.total_placed || 0;
        const kd = (kills / Math.max(1, deaths)).toFixed(2);
        const playtime = Math.floor((custom['PLAY_ONE_MINUTE'] || 0) / 20 / 60 / 60) + 'h';

        const damage = Math.floor((custom['DAMAGE_DEALT'] || 0) / 10);
        const uuid = player.uuid;

        let gridHtml = `
            <div class="stat-card"><span class="stat-label">Playtime</span><span class="stat-value">${playtime}</span></div>
            <div class="stat-card"><span class="stat-label">Deaths</span><span class="stat-value" data-count="${deaths}" data-stat-key="${uuid}_deaths">${deaths}</span></div>
            <div class="stat-card"><span class="stat-label">Kills</span><span class="stat-value" data-count="${kills}" data-stat-key="${uuid}_kills">${kills}</span></div>
            <div class="stat-card"><span class="stat-label">K/D</span><span class="stat-value" data-count="${kd}" data-stat-key="${uuid}_kd">${kd}</span></div>
            <div class="stat-card"><span class="stat-label">Mined</span><span class="stat-value" data-count="${mined}" data-stat-key="${uuid}_mined">${mined}</span></div>
            <div class="stat-card"><span class="stat-label">Placed</span><span class="stat-value" data-count="${placed}" data-stat-key="${uuid}_placed">${placed}</span></div>
            <div class="stat-card"><span class="stat-label">Mob Kills</span><span class="stat-value" data-count="${mobs}" data-stat-key="${uuid}_mobs">${mobs}</span></div>
            <div class="stat-card"><span class="stat-label">Damage Dealt</span><span class="stat-value" data-count="${damage}" data-stat-key="${uuid}_damage">${damage}</span></div>`;

        const featured = ['PLAY_ONE_MINUTE', 'DEATHS', 'PLAYER_KILLS', 'MOB_KILLS', 'TOTAL_MINED', 'TOTAL_PLACED'];
        Object.entries(custom).forEach(([key, val]) => {
            if (!featured.includes(key)) {
                const numVal = typeof val === 'number' ? val : parseFloat(val);
                const hasCount = !isNaN(numVal) ? `data-count="${numVal}"` : '';
                gridHtml += `<div class="stat-card"><span class="stat-label">${formatName(key)}</span><span class="stat-value" ${hasCount}>${!isNaN(numVal) ? numVal.toLocaleString() : val}</span></div>`;
            }
        });
        container.innerHTML = gridHtml;
        // Animate all numeric stat values counting up from 0
        animateCounters(container);

        renderStatChart(document.getElementById('mining-graph'), stats['minecraft:mined'] || {}, 'bar-stone');
        renderStatChart(document.getElementById('combat-graph'), stats['minecraft:killed'] || {}, 'bar-emerald');
    }

    function animateCounters(container) {
        container.querySelectorAll('.stat-value[data-count]').forEach(el => {
            const target = parseFloat(el.dataset.count);
            const key = el.dataset.statKey;
            if (isNaN(target) || typeof Odometer === 'undefined') return;
            const isDecimal = el.dataset.count.includes('.');

            // Get previous value from cache (or use target so no animation on first open)
            const prevVal = (key && statCache[key] !== undefined) ? statCache[key] : target;

            // Initialize odometer at previous value
            el.textContent = prevVal;
            const odo = new Odometer({
                el: el,
                value: prevVal,
                format: isDecimal ? '(,ddd).dd' : '(,ddd)',
                theme: 'minimal',
                duration: 800
            });

            // Store new value in cache
            if (key) statCache[key] = target;

            // Animate to new value only if it changed
            if (prevVal !== target) setTimeout(() => odo.update(target), 50);
        });
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

        const sortControls = document.querySelector('.sort-controls');
        currentTab = tab;
        if (tab === 'players') { 
            navPlayers.classList.add('active'); 
            playersSection.style.display = 'block';
            playerGrid.className = 'player-grid';
            if (sortControls) sortControls.classList.add('hide');
            currentSort = 'none';
            sortBySelect.value = 'none';
        } else if (tab === 'leaderboard') { 
            navLeaderboards.classList.add('active'); 
            playersSection.style.display = 'block'; 
            playerGrid.className = 'player-grid';
            if (sortControls) sortControls.classList.remove('hide');
            currentSort = 'none';
            sortBySelect.value = 'none'; 
        } else if (tab === 'health') { 
            navHealth.classList.add('active'); 
            healthSection.style.display = 'block'; 
            setTimeout(renderTripleGraphs, 100); 
        }
        renderAll();
    }

    navPlayers.addEventListener('click', () => switchTab('players'));
    navLeaderboards.addEventListener('click', () => switchTab('leaderboard'));
    navHealth.addEventListener('click', () => switchTab('health'));
    closePanelBtn.addEventListener('click', () => { detailsPanel.classList.remove('open'); selectedPlayer = null; });
    sortBySelect.addEventListener('change', (e) => { currentSort = e.target.value; renderAll(); });
    refreshBtn.addEventListener('click', updateAllData);

    updateAllData();
    setInterval(updateAllData, 30000);
});
