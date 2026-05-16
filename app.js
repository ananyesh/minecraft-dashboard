document.addEventListener('DOMContentLoaded', () => {
    // Master Dashboard Configuration
    const DASHBOARD_CONFIG = {
        ranked_enabled: false, // Set to false to hide all Ranked/ELO stats across the site
        unified_api_url: "/api/data"
    };

    // State Management
    let players = [];
    let serverHealth = { tps: 20, mspt: 0, players_online: 0, players_max: 0 };
    let playerHistory = [];
    let selectedPlayer = null;
    let currentSort = 'none';
    let currentTab = 'players';
    let rankedOnly = false;
    let tpsOdo = null;
    let msptOdo = null;
    let avgTpsOdo = null;
    let avgMsptOdo = null;
    let playersOdo = null;
    let netOdo = null;
    const statCache = {}; // { uuid_statKey: lastValue } for odometer prev->new animation
    let eloMap = {};      // { uuid: calculatedElo } — updated by recalculateAllElos()
    let liveLogs = [];    // Global storage for events to support search/filtering


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
    const faqSection = document.getElementById('faq-section');
    const eventsSection = document.getElementById('events-section');
    
    // Health UI
    const hTPS = document.getElementById('h-tps');
    const hMSPT = document.getElementById('h-mspt');
    const hAvgTPS = document.getElementById('h-avg-tps');
    const hAvgMSPT = document.getElementById('h-avg-mspt');

    const navPlayers = document.getElementById('nav-players');
    const navLeaderboards = document.getElementById('nav-leaderboards');
    const navHealth = document.getElementById('nav-health');
    const navFaq = document.getElementById('nav-faq');
    const navEvents = document.getElementById('nav-events');
    const btnFilterRanked = document.getElementById('btn-filter-ranked');

    // Hide Ranked UI if disabled (only the filter pill, keep the tab)
    if (!DASHBOARD_CONFIG.ranked_enabled) {
        if (btnFilterRanked) btnFilterRanked.style.display = 'none';
    }


    /**
     * Data Sync
     */
    async function updateAllData() {
        try {
            const res = await fetch(DASHBOARD_CONFIG.unified_api_url);
            const data = await res.json();
            if (data.server) serverHealth = data.server;
            if (data.players) players = data.players;
            if (data.history) playerHistory = data.history;
            if (data.live_logs) {
                liveLogs = data.live_logs;
                const newLogs = liveLogs.filter(l => l.time > lastSeenLogTime).reverse();
                newLogs.forEach(log => {
                    showToast(log);
                    lastSeenLogTime = Math.max(lastSeenLogTime, log.time);
                });
            }
            renderAll();
            updateGlobalCompetitionSummary();
            return;
        } catch (e) { console.error("API Sync Error:", e); }
        } finally {
            renderAll();
        }
    }

    let lastSeenLogTime = Math.floor(Date.now() / 1000);

    function updateGlobalCompetitionSummary() {
        if (!liveLogs || !Array.isArray(liveLogs)) return;
        
        const todayStart = new Date().setHours(0,0,0,0) / 1000;
        const dailyLogs = liveLogs.filter(l => l.time >= todayStart);
        
        const totalMatches = dailyLogs.filter(l => l.change !== 0).length;
        const totalWins = dailyLogs.filter(l => l.change > 0).length;
        const totalLosses = dailyLogs.filter(l => l.change < 0).length;
        const netElo = dailyLogs.reduce((sum, l) => sum + (l.change || 0), 0);
        
        const sorted = getSortedPlayers(true);
        const topPlayer = sorted[0];

        const elMatches = document.getElementById('global-matches');
        const elWinLoss = document.getElementById('global-winloss');
        const elNetElo = document.getElementById('global-net-elo');
        const elTopRank = document.getElementById('global-top-rank');
        const elTopName = document.getElementById('global-top-name');

        if (elMatches) elMatches.textContent = totalMatches;
        if (elWinLoss) elWinLoss.textContent = `${totalWins}W - ${totalLosses}L`;
        if (elNetElo) {
            elNetElo.textContent = (netElo >= 0 ? '+' : '') + netElo;
            elNetElo.style.color = netElo >= 0 ? '#38bdf8' : '#ef4444';
        }
        if (elTopRank) elTopRank.textContent = '#1';
        if (elTopName) elTopName.textContent = topPlayer ? topPlayer.username : '---';
    }

    function showToast(log) {
        const container = document.getElementById('toast-container');
        if (!container) return;

        const isRank = log.type === 'PROMOTED' || log.type === 'DEMOTED';
        const isGain = log.change >= 0 || log.type === 'PROMOTED';
        
        let toastClass = isGain ? 'gain' : 'loss';
        if (log.type === 'PROMOTED') toastClass = 'rank-up';
        if (log.type === 'DEMOTED') toastClass = 'rank-down';

        let iconClass = 'fa-arrow-trend-up';
        if (log.type === 'PROMOTED') iconClass = 'fa-trophy';
        if (log.type === 'DEMOTED') iconClass = 'fa-angles-down';
        if (!isGain && !isRank) iconClass = 'fa-arrow-trend-down';

        const toast = document.createElement('div');
        toast.className = `toast ${toastClass}`;
        
        toast.innerHTML = `
            <div class="toast-icon">
                <i class="fa-solid ${iconClass}"></i>
            </div>
            <div class="toast-content">
                <div class="toast-title">
                    ${log.user}
                    <span style="font-weight: 400; font-size: 0.8rem; color: var(--text-muted)">
                        ${isRank ? (log.type === 'PROMOTED' ? 'RANK UP!' : 'RANK DOWN') : `(${isGain ? '+' : ''}${log.change})`}
                    </span>
                </div>
                <div class="toast-msg">${log.type === 'PROMOTED' ? 'New Rank Achieved:' : (log.type === 'DEMOTED' ? 'Rank Adjusted:' : 'Performance Update:')} ${log.details}</div>
            </div>
        `;

        container.appendChild(toast);

        // Auto remove
        setTimeout(() => {
            toast.classList.add('fade-out');
            setTimeout(() => toast.remove(), 600);
        }, 5000);
    }

    // High-frequency poll for Live Logs
    setInterval(updateLiveLogs, 5000);



    function renderAll() {
        if (currentTab === 'players') renderPlayersGrid();
        else if (currentTab === 'leaderboard') renderLeaderboard();
        else if (currentTab === 'faq') renderFaq();
        else if (currentTab === 'events') renderEvents();
        
        renderHealthStatus();
        if (currentTab === 'health') renderQuadGraphs();

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
        const netIn = serverHealth.net_in || 0;
        const netOut = serverHealth.net_out || 0;
        const netTotal = netIn + netOut;

        const tpsEl = document.getElementById('h-tps');
        const msptEl = document.getElementById('h-mspt');
        const hAvgTPS = document.getElementById('h-avg-tps');
        const hAvgMSPT = document.getElementById('h-avg-mspt');

        // Calculate 24h Summary Data
        const history = playerHistory || [];
        const recentHistory = history.slice(-288); // Approx 24h

        const avgTpsVal = recentHistory.length > 0 ? recentHistory.reduce((sum, h) => sum + (h.t || 20), 0) / recentHistory.length : tps;
        const avgMsptVal = recentHistory.length > 0 ? recentHistory.reduce((sum, h) => sum + (h.m || 0), 0) / recentHistory.length : mspt;

        const peakTpsVal = recentHistory.length > 0 ? Math.max(...recentHistory.map(h => h.t || 0)) : tps;
        const lowTpsVal = recentHistory.length > 0 ? Math.min(...recentHistory.map(h => h.t || 20)) : tps;
        const peakMsptVal = recentHistory.length > 0 ? Math.max(...recentHistory.map(h => h.m || 0)) : mspt;
        const lowMsptVal = recentHistory.length > 0 ? Math.min(...recentHistory.map(h => h.m || 0)) : mspt;
        const peakPlayersVal = recentHistory.length > 0 ? Math.max(...recentHistory.map(h => h.p || 0)) : players.filter(p => p.online).length;
        const peakNetVal = recentHistory.length > 0 ? Math.max(...recentHistory.map(h => (h.ni || 0) + (h.no || 0))) : netTotal;

        // 1. Update Odometer Cards (Real-time & Averages)
        if (typeof Odometer !== 'undefined') {
            if (!tpsOdo && tpsEl) tpsOdo = new Odometer({ el: tpsEl, value: tps, format: 'd', theme: 'minimal', duration: 800 });
            if (!msptOdo && msptEl) msptOdo = new Odometer({ el: msptEl, value: mspt, format: 'd', theme: 'minimal', duration: 800 });
            if (!avgTpsOdo && hAvgTPS) avgTpsOdo = new Odometer({ el: hAvgTPS, value: avgTpsVal, format: 'd', theme: 'minimal', duration: 800 });
            if (!avgMsptOdo && hAvgMSPT) avgMsptOdo = new Odometer({ el: hAvgMSPT, value: avgMsptVal, format: 'd', theme: 'minimal', duration: 800 });

            if (tpsOdo) tpsOdo.update(Math.round(tps));
            if (msptOdo) msptOdo.update(Math.round(mspt));
            if (avgTpsOdo) avgTpsOdo.update(Math.round(avgTpsVal));
            if (avgMsptOdo) avgMsptOdo.update(Math.round(avgMsptVal));
        } else {
            if (tpsEl) tpsEl.textContent = tps.toFixed(1);
            if (msptEl) msptEl.textContent = Math.round(mspt);
            if (hAvgTPS) hAvgTPS.textContent = avgTpsVal.toFixed(1);
            if (hAvgMSPT) hAvgMSPT.textContent = Math.round(avgMsptVal);
        }

        // 2. Update Summary Grid (Peaks/Lows)
        const elPeakTps = document.getElementById('peak-tps');
        const elLowTps = document.getElementById('low-tps');
        const elPeakMspt = document.getElementById('peak-mspt');
        const elLowMspt = document.getElementById('low-mspt');
        const elPeakPlayers = document.getElementById('peak-players');
        const elPeakNet = document.getElementById('peak-net');

        if (elPeakTps) elPeakTps.textContent = peakTpsVal.toFixed(2);
        if (elLowTps) elLowTps.textContent = lowTpsVal.toFixed(2);
        if (elPeakMspt) elPeakMspt.textContent = peakMsptVal.toFixed(1);
        if (elLowMspt) elLowMspt.textContent = lowMsptVal.toFixed(1);
        if (elPeakPlayers) elPeakPlayers.textContent = peakPlayersVal;
        if (elPeakNet) elPeakNet.textContent = peakNetVal.toFixed(1);

        // Update System Status Labels
        const elPerf = document.getElementById('status-perf');
        const elStatusTps = document.getElementById('status-tps');
        const elStatusNet = document.getElementById('status-net');
        const elStatusCap = document.getElementById('status-capacity');

        if (elPerf) {
            if (tps > 19.5 && mspt < 25) { elPerf.textContent = 'Excellent'; elPerf.className = 'status-value status-excellent'; }
            else if (tps > 18.0) { elPerf.textContent = 'Good'; elPerf.className = 'status-value status-stable'; }
            else { elPerf.textContent = 'Degraded'; elPerf.className = 'status-value status-critical'; }
        }

        if (elStatusTps) {
            const tpsVar = peakTpsVal - lowTpsVal;
            if (tpsVar < 0.2) { elStatusTps.textContent = 'Stable'; elStatusTps.className = 'status-value status-stable'; }
            else if (tpsVar < 1.0) { elStatusTps.textContent = 'Fluctuating'; elStatusTps.className = 'status-value status-moderate'; }
            else { elStatusTps.textContent = 'Unstable'; elStatusTps.className = 'status-value status-critical'; }
        }

        if (elStatusNet) {
            if (netTotal < 10) { elStatusNet.textContent = 'Stable'; elStatusNet.className = 'status-value status-stable'; }
            else if (netTotal < 50) { elStatusNet.textContent = 'Elevated'; elStatusNet.className = 'status-value status-elevated'; }
            else { elStatusNet.textContent = 'Critical'; elStatusNet.className = 'status-value status-critical'; }
        }

        if (elStatusCap) {
            const cap = players.filter(p => p.online).length / Math.max(1, serverHealth.players_max);
            if (cap < 0.5) { elStatusCap.textContent = 'Low Load'; elStatusCap.className = 'status-value status-excellent'; }
            else if (cap < 0.9) { elStatusCap.textContent = 'Moderate'; elStatusCap.className = 'status-value status-moderate'; }
            else { elStatusCap.textContent = 'Full'; elStatusCap.className = 'status-value status-critical'; }
        }
    }

    function renderQuadGraphs() {
        if (!playerHistory || playerHistory.length < 2) return;
        renderSingleChart('graph-players', 'p', 'var(--player-color)', 'line-players');
        renderSingleChart('graph-tps', 't', 'var(--tps-color)', 'line-tps');
        renderSingleChart('graph-mspt', 'm', 'var(--mspt-color)', 'line-mspt');
        renderSingleChart('graph-net', 'ni', '#3b82f6', 'line-net');
    }

    function renderSingleChart(svgId, key, color, lineClass) {
        const svg = document.getElementById(svgId);
        if (!svg) return;
        
        const w = svg.clientWidth;
        const h = 160;
        const marginL = 35, marginB = 35, marginT = 15, marginR = 15;
        const chartW = w - marginL - marginR;
        const chartH = h - marginB - marginT;

        const count = playerHistory.length;
        if (count < 2) {
            svg.innerHTML = ''; 
            return;
        }

        // Dynamic Scaling
        const values = playerHistory.map(d => {
            if (key === 'ni') return (d.ni || 0) + (d.no || 0);
            return d[key] || 0;
        });
        
        let minVal = Math.min(...values);
        let maxVal = Math.max(...values);
        
        // Add padding to scaling
        if (key === 't') { // TPS: focus on 15-20 usually
            maxVal = 20.1;
            minVal = Math.min(minVal, 19.0) - 0.2;
        } else {
            const padding = (maxVal - minVal) * 0.1 || 1;
            maxVal += padding;
            minVal = Math.max(0, minVal - padding);
        }

        const stepX = chartW / (count - 1);
        const getY = (val) => marginT + chartH - (((val - minVal) / Math.max(0.1, maxVal - minVal)) * chartH);
        
        let innerHTML = '';

        // Draw Horizontal Grid Lines & Y Axis Labels
        const gridCount = 4;
        for (let i = 0; i <= gridCount; i++) {
            const val = minVal + (maxVal - minVal) / gridCount * i;
            const y = getY(val);
            innerHTML += `
                <line x1="${marginL}" y1="${y}" x2="${w - marginR}" y2="${y}" class="grid-line"></line>
                <text x="${marginL - 8}" y="${y + 3}" class="axis-text axis-y">${val < 10 ? val.toFixed(1) : Math.round(val)}</text>
            `;
        }

        // Draw Data Path
        const points = playerHistory.map((d, i) => {
            const val = key === 'ni' ? (d.ni || 0) + (d.no || 0) : d[key];
            return `${marginL + i * stepX},${getY(val)}`;
        });
        innerHTML += `<path d="M ${points.join(' L ')}" class="graph-line ${lineClass}"></path>`;

        // Draw X Axis Time Labels (Sample points)
        const xSampleCount = 5;
        const xInterval = Math.max(1, Math.floor((count - 1) / (xSampleCount - 1)));
        for (let i = 0; i < xSampleCount; i++) {
            const idx = Math.min(i * xInterval, count - 1);
            const d = playerHistory[idx];
            if (!d) continue;
            
            const x = marginL + idx * stepX;
            const date = new Date(d.ts * 1000);
            const timeStr = date.getHours().toString().padStart(2, '0') + ':' + date.getMinutes().toString().padStart(2, '0');
            
            innerHTML += `
                <text x="${x}" y="${h - 8}" class="axis-text axis-x" transform="rotate(-30, ${x}, ${h - 5})">${timeStr}</text>
            `;
            
            // Add a small tick
            innerHTML += `<line x1="${x}" y1="${marginT + chartH}" x2="${x}" y2="${marginT + chartH + 5}" class="grid-line" style="opacity:0.3"></line>`;
        }

        svg.innerHTML = innerHTML;
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
    setupChartTracking('wrapper-net', 'graph-net', 'tooltip-net', 'ni', 'Net In', ' Mbps');

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
                    ${(player.ranked || 0) > 0 && DASHBOARD_CONFIG.ranked_enabled ? `<div class="p-ranked-badge"><i class="fa-solid fa-crown"></i> Rank #${player.ranked}</div>` : ''}
                    <div class="p-avatar"><img src="https://mc-heads.net/avatar/${skinIdentity}/80" alt="${player.username}"></div>
                    <div class="p-name">${player.username}</div>
                    <div class="p-status ${player.online ? 'online' : 'offline'}">
                        <span class="status-dot"></span> ${player.online ? 'Active' : 'Offline'}
                    </div>
                    <div class="p-stats-mini">
                        <div class="p-stat-item" title="Player Kills"><i class="fa-solid fa-skull"></i> <span class="p-stat-val">${custom['PLAYER_KILLS'] || 0}</span></div>
                        <div class="p-stat-item" title="Deaths"><i class="fa-solid fa-ghost"></i> <span class="p-stat-val">${custom['DEATHS'] || 0}</span></div>
                        <div class="p-stat-item" title="Playtime"><i class="fa-solid fa-clock"></i> <span class="p-stat-val">${Math.floor((custom['PLAY_ONE_MINUTE'] || 0) / 20 / 60 / 60)}h</span></div>
                    </div>
                    <div class="p-rank-badge" style="margin-top:12px; color:${getRank(calculateElo(player)).color};border-color:${getRank(calculateElo(player)).color}44;background:${getRank(calculateElo(player)).color}11">
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
        const sorted = getSortedPlayers(true);
        if (sorted.length === 0) { playerGrid.innerHTML = '<div class="loading-state"><p>No competition data yet.</p></div>'; return; }

        // --- Calculate Global Competition Summary (Power Trio) ---
        updateGlobalCompetitionSummary();
        // ---------------------------------------------------------

        let currentRank = 1;
        let previousVal = null;
        
        // 1. Calculate true ranks before filtering, so even lower players see exact global placement
        const rankedPlayers = sorted.map((player, index) => {
            const stats = player.stats || {};
            const custom = stats['minecraft:custom'] || {};
            const skinIdentity = player.skin || player.username;
            
            const elo = calculateElo(player);
            let displayVal = elo, displayLabel = 'ELO';
            if (currentSort === 'kills') { displayVal = custom['PLAYER_KILLS'] || 0; displayLabel = 'Kills'; }
            else if (currentSort === 'playtime') { displayVal = Math.floor((custom['PLAY_ONE_MINUTE'] || 0) / 20 / 60 / 60) + 'h'; displayLabel = 'Playtime'; }
            else if (currentSort === 'mined') { displayVal = stats.total_mined || 0; displayLabel = 'Mined'; }
            
            // Standard competition ranking (1, 2, 2, 4)
            if (previousVal !== displayVal) {
                currentRank = index + 1;
                previousVal = displayVal;
            }
            
            return { ...player, rank: currentRank, displayVal, displayLabel, elo, skinIdentity };
        });

        // 2. Filter by search logic and limit to top 100
        const searchTerm = searchInput.value.toLowerCase();
        const filtered = rankedPlayers.filter(p => p.username.toLowerCase().includes(searchTerm)).slice(0, 100);

        if (filtered.length === 0) { playerGrid.innerHTML = '<div class="loading-state"><p>No players found.</p></div>'; return; }

        let html = '<div class="leaderboard-list">';
        html += filtered.map((playerData) => {
            const eloRank = getRank(playerData.elo);
            
            // Calculate progress to next rank
            const min = eloRank.min || 0;
            const next = eloRank.next || 100;
            const range = next - min;
            const progress = range > 0 ? Math.min(100, Math.max(0, ((playerData.elo - min) / range) * 100)) : 100;

            const isOnline = playerData.online && serverHealth.status !== 'offline';

            return `
                <div class="leader-row rank-${playerData.rank}" onclick="showPlayerDetails('${playerData.uuid}')" style="border-color:${eloRank.color}33; border-left:3px solid ${eloRank.color}">
                    <div class="rank-number" style="color:${eloRank.color}">${playerData.rank}</div>
                    <div class="leader-avatar"><img src="https://mc-heads.net/avatar/${playerData.skinIdentity}/42" alt="${playerData.username}"></div>
                    <div class="leader-info">
                        <div class="leader-name-wrapper">
                            <span class="leader-name" title="${playerData.username}">${playerData.username}</span>
                            <span class="elo-rank-pill" style="color:${eloRank.color};border-color:${eloRank.color}44;background:${eloRank.color}11">${eloRank.icon} ${eloRank.name}</span>
                        </div>
                        <div class="l-stats-mini">
                            <span class="leader-status">${isOnline ? '● Active' : '○ Offline'}</span>
                            <span class="l-stat-item l-stat-strength"><i class="fa-solid fa-hand-fist"></i> ${playerData.strength || 0}</span>
                            <span class="l-stat-item l-stat-weapon"><i class="fa-solid ${getWeaponIcon(playerData.weapon)}"></i> ${playerData.weapon || 'None'}</span>
                            ${(playerData.ranked || 0) > 0 ? `<span class="l-stat-item" style="color:#fbbf24; font-weight:700;"><i class="fa-solid fa-crown"></i> ${playerData.ranked}</span>` : ''}
                        </div>
                    </div>
                    <div class="leader-metric">
                        <span class="m-val" style="color:${currentSort === 'none' ? eloRank.color : 'var(--primary)'}">${playerData.displayVal}</span>
                        <span class="m-lab">${playerData.displayLabel}</span>
                        <div class="mini-rank-progress">
                            <div class="mini-rank-fill" style="width: ${progress}%; background: ${eloRank.color}; --primary-glow: ${eloRank.color}66;"></div>
                        </div>
                    </div>
                </div>`;
        }).join('');
        html += '</div>';
        
        // SWITCH TO LIST MODE
        playerGrid.className = 'leaderboard-mode';
        
        playerGrid.innerHTML = html;
        onlineCountLabel.textContent = `${players.filter(p => p.online).length}/${players.length}`;
    }

    function calculateElo(player) {
        // Now using authoritative ELO synced from the Java backend
        return player.elo ?? 0;
    }

    function getRank(elo) {
        if (elo >= 2500) return { name: 'Netherite', color: '#9D84CD', icon: '🖤', min: 2500, next: 4000 };
        if (elo >= 1200) return { name: 'Diamond',   color: '#7BFCFF', icon: '💎', min: 1200, next: 2500 };
        if (elo >= 500)  return { name: 'Emerald',   color: '#44E880', icon: '💚', min: 500,  next: 1200 };
        if (elo >= 150)  return { name: 'Gold',      color: '#FFD700', icon: '🥇', min: 150,  next: 500  };
        if (elo >= 0)    return { name: 'Iron',      color: '#C8C8C8', icon: '⚙️', min: 0,    next: 150  };
        return              { name: 'Dirt',       color: '#A0714A', icon: '🟫', min: -100, next: 0    };
    }

    function getSortedPlayers(forLeaderboard = false) {
        let sorted = [...players];
        
        // If it's for the leaderboard, we ONLY care about ELO/chosen metric
        if (forLeaderboard) {
            if (currentSort === 'playtime') {
                return sorted.sort((a, b) => (b.stats?.['minecraft:custom']?.['PLAY_ONE_MINUTE'] || 0) - (a.stats?.['minecraft:custom']?.['PLAY_ONE_MINUTE'] || 0));
            } else if (currentSort === 'mined') {
                return sorted.sort((a, b) => (b.stats?.['total_mined'] || 0) - (a.stats?.['total_mined'] || 0));
            } else if (currentSort === 'kills') {
                return sorted.sort((a, b) => (b.stats?.['minecraft:custom']?.['PLAYER_KILLS'] || 0) - (a.stats?.['minecraft:custom']?.['PLAYER_KILLS'] || 0));
            } else {
                return sorted.sort((a, b) => calculateElo(b) - calculateElo(a));
            }
        }

        // For Player Grid, apply custom Rank logic if button is active
        if (currentSort === 'playtime') {
            sorted.sort((a, b) => (b.stats?.['minecraft:custom']?.['PLAY_ONE_MINUTE'] || 0) - (a.stats?.['minecraft:custom']?.['PLAY_ONE_MINUTE'] || 0));
        } else if (currentSort === 'mined') {
            sorted.sort((a, b) => (b.stats?.['total_mined'] || 0) - (a.stats?.['total_mined'] || 0));
        } else if (currentSort === 'kills') {
            sorted.sort((a, b) => (b.stats?.['minecraft:custom']?.['PLAYER_KILLS'] || 0) - (a.stats?.['minecraft:custom']?.['PLAYER_KILLS'] || 0));
        } else {
            sorted.sort((a, b) => {
                // ONLY prioritize Rank if button is active and we are in Grid
                if (rankedOnly) {
                    const rA = Number(a.ranked || 999);
                    const rB = Number(b.ranked || 999);
                    if (rA < 999 || rB < 999) return rA - rB;
                }
                return calculateElo(b) - calculateElo(a);
            });
        }

        if (rankedOnly) {
            sorted = sorted.filter(p => (p.ranked || 0) > 0);
        }

        return sorted;
    }

    /**
     * Detail Panel Logic
     */
    window.showPlayerDetails = (uuid) => {
        const player = players.find(p => p.uuid === uuid);
        if (!player) return;
        selectedPlayer = player;
        window.updateDetailPanel(player);
        detailsPanel.classList.add('open');
    };

    window.updateDetailPanel = (player) => {
        try {
            const elo = calculateElo(player);
            const eloRank = getRank(elo);
            const sortedP = [...players].sort((a, b) => (b.elo || 0) - (a.elo || 0));
            const currentRank = sortedP.findIndex(p => p.uuid === player.uuid) + 1;
            
            // 1. Banner Color
            const banner = document.getElementById('profile-banner');
            if (banner) {
                banner.style.background = `linear-gradient(135deg, ${eloRank.color}33, rgba(0,0,0,0.8))`;
            }

            // 2. Identity Header
            const usernameEl = document.getElementById('detail-username');
            if (usernameEl) usernameEl.textContent = player.username || "Unknown";
            
            const avatarEl = document.getElementById('detail-avatar-body');
            if (avatarEl) {
                const skinIdentity = player.skin || player.username || "steve";
                avatarEl.src = `https://mc-heads.net/avatar/${skinIdentity}/160`;
            }

            const badgesEl = document.getElementById('detail-badges');
            if (badgesEl) {
                const isOnline = player.online;
                badgesEl.innerHTML = `
                    ${(player.ranked || 0) > 0 && DASHBOARD_CONFIG.ranked_enabled ? `<span class="elo-rank-pill" style="color:#fbbf24; border-color:#fbbf2444; background:#fbbf2411"><i class="fa-solid fa-crown"></i> Ranked #${player.ranked}</span>` : ''}
                    <span class="elo-rank-pill" style="color:${eloRank.color};border-color:${eloRank.color}44;background:${eloRank.color}11">${eloRank.icon} ${eloRank.name}</span>
                    <span class="leader-status" style="font-size: 11px;">${isOnline ? '● Active' : '○ Offline'}</span>
                `;
            }

            // 3. Hero Stats
            const heroElo = document.getElementById('hero-elo');
            const heroRankName = document.getElementById('hero-rank-name');
            const isRanked = (player.ranked || 0) > 0 && DASHBOARD_CONFIG.ranked_enabled;
            const hasElo = (player.elo || 0) >= 0; // Always show ELO
            
            // Hide/Show Ranked Hero Cards
            if (heroElo) {
                heroElo.closest('.hero-stat-card').style.display = hasElo ? 'flex' : 'none';
                heroElo.textContent = elo;
            }
            if (heroRankName) heroRankName.textContent = eloRank.name + ' Rank';
            // Show Leaderboard Placement (Always show ELO-based global rank)
            const heroRankEl = document.getElementById('hero-rank');
            if (heroRankEl) {
                heroRankEl.closest('.hero-stat-card').style.display = 'flex';
                heroRankEl.textContent = '#' + currentRank;
            }

            // 4. General Stats
            const stats = player.stats || {};
            const custom = stats['minecraft:custom'] || {};
            const container = document.getElementById('general-stats-container');
            
            if (container) {
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

                const featured = ['PLAY_ONE_MINUTE', 'DEATHS', 'PLAYER_KILLS', 'MOB_KILLS', 'TOTAL_MINED', 'TOTAL_PLACED', 'DAMAGE_DEALT'];
                Object.entries(custom).forEach(([key, val]) => {
                    if (!featured.includes(key)) {
                        let numVal = typeof val === 'number' ? val : parseFloat(val);
                        let label = formatName(key);
                        if (key.endsWith('_ONE_CM')) {
                            numVal = (numVal / 100).toFixed(1);
                            label = label.replace(' One Cm', '') + ' (m)';
                        }
                        if (!isNaN(numVal)) {
                            gridHtml += `<div class="stat-card"><span class="stat-label">${label}</span><span class="stat-value" data-count="${numVal}" data-stat-key="${uuid}_${key}">${numVal}</span></div>`;
                        } else {
                            gridHtml += `<div class="stat-card"><span class="stat-label">${label}</span><span class="stat-value">${val}</span></div>`;
                        }
                    }
                });
                container.innerHTML = gridHtml;

                let existingBtn = document.getElementById('btn-kill-logs');
                if (existingBtn) existingBtn.remove();
                let btn = document.createElement('button');
                btn.id = 'btn-kill-logs';
                btn.className = 'app-btn';
                btn.innerHTML = '<i class="fa-solid fa-scroll"></i> View Elo History';
                btn.onclick = () => openKillLogsModal(uuid);
                container.parentNode.appendChild(btn);
            }

            // Render Elo Trajectory
            const svgElo = document.getElementById('svg-elo-progression');
            if (svgElo) {
                svgElo.innerHTML = '';
                const currentElo = player.elo || 0;
                const logs = player.elo_logs || []; // Now Objects from Java
                let temp = currentElo;
                const historyData = [temp]; 
                const historyTime = [Math.floor(Date.now() / 1000)];
                const rankHistory = [];
                const rankTime = [];
                
                // Backtrack from current ELO (logs are latest first from Java)
                for (let i = 0; i < logs.length; i++) {
                    try {
                        const log = logs[i];
                        const change = parseInt(log.change || 0);
                        const rk = parseInt(log.rank || 0);
                        temp -= change;
                        historyData.unshift(temp); 
                        historyTime.unshift(log.time);
                        if (rk > 0) {
                            rankHistory.unshift(rk);
                            rankTime.unshift(log.time);
                        }
                    } catch(e) {}
                }
                
                // Smart fallback for empty history
                if (historyData.length < 2) {
                    historyData.unshift(currentElo); 
                    historyTime.unshift(historyTime[0] - 86400); // 1 day ago fallback
                }

                const sortedP = [...players].sort((a, b) => (b.elo || 0) - (a.elo || 0));
                const currentRank = sortedP.findIndex(p => p.uuid === player.uuid) + 1;
                
                // Append current rank to the end of history
                rankHistory.push(currentRank);
                rankTime.push(Math.floor(Date.now() / 1000));
                
                // If still empty (legacy logs), make a flat line
                if (rankHistory.length === 1) {
                    rankHistory.unshift(currentRank);
                    rankTime.unshift(rankTime[0] - 86400);
                }
                
                svgElo.setAttribute('viewBox', `0 0 1000 100`);
                const maxVal = Math.max(...historyData) + 20;
                const minVal = Math.min(...historyData) - 10;
                const range = Math.max(1, maxVal - minVal);
                const stepX = 1000 / (historyData.length - 1);
                const getY = (val) => 100 - (((val - minVal) / range) * 80 + 10); 
                const pts = historyData.map((d, i) => ({ x: i * stepX, y: getY(d) }));
                const curve = getBezierCurve(pts);
                
                // Helper to render interactive slices
                const renderSlices = (pList, dataArr, timeArr, unit, cId) => pList.map((p, i) => {
                    const w = 1000 / pList.length;
                    const d = new Date(timeArr[i] * 1000);
                    const timeStr = d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
                    const tooltipHtml = `<div style="font-weight:800; color:var(--primary); font-size:14px;">${dataArr[i]} ${unit}</div><div style="font-size:10px; opacity:0.6; margin-top:2px;">${timeStr}</div>`;
                    
                    return `<rect class="chart-slice" x="${p.x - w/2}" y="0" width="${w}" height="100" 
                        fill="transparent" stroke="none" 
                        onmouseenter="handleChartHover(event, '${cId}', '${tooltipHtml.replace(/"/g, '&quot;')}', ${p.x})" 
                        onmouseleave="hideChartHover('${cId}')"></rect>`;
                }).join('');

                svgElo.innerHTML = `
                    <defs><linearGradient id="gElo" x1="0%" y1="0%" x2="0%" y2="100%"><stop offset="0%" stop-color="var(--primary)" stop-opacity="0.3" /><stop offset="100%" stop-color="var(--primary)" stop-opacity="0" /></linearGradient></defs>
                    <path d="${curve} L 1000,100 L 0,100 Z" fill="url(#gElo)" stroke="none"></path>
                    <path d="${curve}" fill="none" stroke="var(--primary)" stroke-width="3" stroke-linecap="round"></path>
                    ${pts.map((p, i) => `<circle cx="${p.x}" cy="${p.y}" r="3" fill="#111" stroke="var(--primary)" stroke-width="2"></circle>`).join('')}
                    ${renderSlices(pts, historyData.map(Math.round), historyTime, 'ELO', 'crosshair-elo')}
                `;

                const svgRank = document.getElementById('svg-rank-progression');
                if (svgRank) {
                    svgRank.innerHTML = '';
                    svgRank.setAttribute('viewBox', `0 0 1000 100`);
                    const maxR = Math.max(...rankHistory) + 2;
                    const minR = 1;
                    const rRange = Math.max(1, maxR - minR);
                    const rStepX = 1000 / (rankHistory.length - 1);
                    const getRY = (val) => ((val - minR) / rRange) * 80 + 10; 
                    const rPts = rankHistory.map((r, i) => ({ x: i * rStepX, y: getRY(r) }));
                    const rCurve = getBezierCurve(rPts);
                    svgRank.innerHTML = `
                        <path d="${rCurve}" fill="none" stroke="#60a5fa" stroke-width="2" stroke-dasharray="4 4" stroke-linecap="round"></path>
                        ${rPts.map((p, i) => `<circle cx="${p.x}" cy="${p.y}" r="4" fill="#111" stroke="#60a5fa" stroke-width="1.5"></circle>`).join('')}
                        ${renderSlices(rPts, rankHistory.map(r => 'Rank #' + r), rankTime, '', 'crosshair-rank')}
                    `;
                }
            }
            
            const miningGraph = document.getElementById('mining-graph');
            const combatGraph = document.getElementById('combat-graph');
            if (miningGraph) renderStatChart(miningGraph, stats['minecraft:mined'] || {}, 'bar-stone');
            if (combatGraph) renderStatChart(combatGraph, stats['minecraft:killed'] || {}, 'bar-emerald');
            
            if (container) animateCounters(container);
        } catch (err) {
            console.error("Critical error in updateDetailPanel:", err);
        }
    }

    function getBezierCurve(pts) {
        if (!pts || pts.length === 0) return "";
        if (pts.length === 1) return `M ${pts[0].x},${pts[0].y}`;
        let d = `M ${pts[0].x},${pts[0].y}`;
        for (let i = 0; i < pts.length - 1; i++) {
            const p0 = pts[i];
            const p1 = pts[i + 1];
            const cp1x = p0.x + (p1.x - p0.x) / 2;
            const cp2x = p0.x + (p1.x - p0.x) / 2;
            d += ` C ${cp1x},${p0.y} ${cp2x},${p1.y} ${p1.x},${p1.y}`;
        }
        return d;
    }

    function animateCounters(container) {
        container.querySelectorAll('.stat-value[data-count]').forEach(el => {
            const target = parseFloat(el.dataset.count);
            const key = el.dataset.statKey;
            if (isNaN(target) || typeof Odometer === 'undefined') return;
            const isDecimal = el.dataset.count.includes('.');

            // Get previous value from cache (first open = no animation, just show value)
            const prevVal = (key && statCache[key] !== undefined) ? statCache[key] : target;

            const odo = new Odometer({
                el: el,
                value: prevVal,
                format: isDecimal ? '(,ddd).dd' : '(,ddd)',
                theme: 'minimal',
                duration: 800
            });

            if (key) statCache[key] = target;
            odo.update(target);
        });
    }

    function renderStatChart(container, data, barClass) {
        if (!container) return;
        const sorted = Object.entries(data)
            .sort((a,b) => b[1] - a[1])
            .slice(0, 5); // Kept to top 5 for cleaner look
        
        if (sorted.length === 0) {
            container.innerHTML = '<div class="no-data">No recorded activity.</div>';
            return;
        }

        const max = Math.max(...sorted.map(s => s[1]), 1);
        container.innerHTML = sorted.map(([key, val]) => {
            const width = (val / max) * 100;
            const label = formatName(key);
            const ctxColor = getContextClass(key) || barClass;
            const icon = getContextIcon(key);
            return `
                <div class="graph-row" style="margin-bottom: 15px;">
                    <div class="graph-label" style="display:flex; justify-content:space-between; align-items:center; margin-bottom: 6px;">
                        <span>${icon} ${label}</span>
                        <span style="font-family: 'JetBrains Mono', monospace; font-weight: 800; color: var(--text-main);">${val.toLocaleString()}</span>
                    </div>
                    <div class="graph-bar-container">
                        <div class="graph-bar ${ctxColor}" style="width: ${width}%"></div>
                    </div>
                </div>`;
        }).join('');
    }

    function getContextIcon(key) {
        if (key.includes('diamond')) return '💎';
        if (key.includes('gold')) return '🟡';
        if (key.includes('iron')) return '⚙️';
        if (key.includes('coal')) return '⚫';
        if (key.includes('lapis')) return '🔵';
        if (key.includes('redstone')) return '🔴';
        if (key.includes('emerald')) return '💚';
        if (key.includes('stone') || key.includes('cobble')) return '🪨';
        if (key.includes('zombie')) return '🧟';
        if (key.includes('creeper')) return '🧨';
        if (key.includes('skeleton')) return '☠️';
        if (key.includes('player')) return '⚔️';
        return '📦';
    }

    function formatName(str) {
        return str.replace('minecraft:', '').split('_').map(w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()).join(' ');
    }

    function getContextClass(key) {
        if (key.includes('diamond')) return 'bar-diamond';
        if (key.includes('gold')) return 'bar-gold';
        if (key.includes('iron')) return 'bar-iron';
        if (key.includes('coal')) return 'bar-coal';
        if (key.includes('lapis')) return 'bar-lapis';
        if (key.includes('redstone')) return 'bar-redstone';
        if (key.includes('copper')) return 'bar-copper';
        if (key.includes('wood') || key.includes('log')) return 'bar-wood';
        if (key.includes('emerald')) return 'bar-emerald';
        if (key.includes('stone') || key.includes('cobble')) return 'bar-stone';
        if (key.includes('zombie') || key.includes('skeleton') || key.includes('creeper') || key.includes('spider')) return 'bar-offline';
        return null;
    }

    function renderFaq() {} // FAQ is static HTML, no JS rendering needed



    function switchTab(tab) {
        currentTab = tab;
        document.querySelectorAll('.nav-item').forEach(el => el.classList.remove('active'));
        playersSection.style.display = 'none';
        healthSection.style.display = 'none';
        faqSection.style.display = 'none';
        eventsSection.style.display = 'none';

        if (tab === 'players') {
            navPlayers.classList.add('active'); 
            playersSection.style.display = 'block'; 
            playerGrid.className = 'player-grid'; 
        } else if (tab === 'leaderboard') {
            navLeaderboards.classList.add('active'); 
            playersSection.style.display = 'block'; 
        } else if (tab === 'health') {
            navHealth.classList.add('active'); 
            healthSection.style.display = 'block'; 
            setTimeout(renderQuadGraphs, 100);
        } else if (tab === 'faq') {
            navFaq.classList.add('active');
            faqSection.style.display = 'block';
        } else if (tab === 'events') {
            navEvents.classList.add('active');
            eventsSection.style.display = 'block';
        }
        renderAll();
    }

    navPlayers.addEventListener('click', () => switchTab('players'));
    navLeaderboards.addEventListener('click', () => switchTab('leaderboard'));
    navHealth.addEventListener('click', () => switchTab('health'));
    navFaq.addEventListener('click', () => switchTab('faq'));
    navEvents.addEventListener('click', () => switchTab('events'));
    closePanelBtn.addEventListener('click', () => { detailsPanel.classList.remove('open'); selectedPlayer = null; });
    sortBySelect.addEventListener('change', (e) => { currentSort = e.target.value; renderAll(); });
    refreshBtn.addEventListener('click', updateAllData);

    if (btnFilterRanked) {
        btnFilterRanked.addEventListener('click', () => {
            rankedOnly = !rankedOnly;
            btnFilterRanked.classList.toggle('active', rankedOnly);
            renderAll();
        });
    }

    // Search: re-render instantly as you type
    searchInput.addEventListener('input', () => {
        if (currentTab === 'players') renderPlayersGrid();
        else if (currentTab === 'leaderboard') renderLeaderboard();
        else if (currentTab === 'events') renderEvents();
    });

    // FAQ accordion: click question to toggle answer
    document.addEventListener('click', (e) => {
        const card = e.target.closest('.faq-card');
        if (!card) return;
        const isOpen = card.classList.contains('faq-open');
        document.querySelectorAll('.faq-card.faq-open').forEach(c => c.classList.remove('faq-open'));
        if (!isOpen) card.classList.add('faq-open');
    });

    // Global functions for modal overlay
    window.openKillLogsModal = function(uuid) {
        const player = players.find(p => p.uuid === uuid);
        if (!player) return;
        
        const logs = player.elo_logs || [];
        const listContainer = document.getElementById('kill-logs-list');
        
        if (logs.length === 0) {
            listContainer.innerHTML = '<div class="kill-log-empty">No Elo history recorded yet.</div>';
        } else {
            listContainer.innerHTML = logs.map(l => {
                const date = new Date(l.time * 1000);
                const timeStr = date.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
                const isPositive = l.change >= 0;
                const changeStr = isPositive ? `+${l.change}` : `${l.change}`;
                const changeColor = isPositive ? '#4ade80' : '#ef4444';
                const icon = l.type === 'Kill' ? '⚔️' : (l.type === 'Death' ? '💀' : '⏳');

                return `
                <div class="kill-log-row">
                    <div class="kill-log-victim">
                        <span style="font-size:18px; margin-right:8px;">${icon}</span>
                        <div style="display:flex; flex-direction:column;">
                            <span style="font-size:14px; font-weight:600;">${l.type}: ${l.details}</span>
                            <span style="font-size:11px; color:var(--text-muted);">${timeStr}</span>
                        </div>
                    </div>
                    <div style="color:${changeColor}; font-weight:800; font-family:monospace; background:rgba(0,0,0,0.2); padding:4px 8px; border-radius:4px;">
                        ${changeStr} ELO
                    </div>
                </div>`;
            }).join('');
        }
        document.getElementById('kill-logs-overlay').classList.add('active');
    };

    window.closeKillLogsModal = function() {
        document.getElementById('kill-logs-overlay').classList.remove('active');
    };

    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') {
            const overlay = document.getElementById('kill-logs-overlay');
            if (overlay && overlay.classList.contains('active')) {
                window.closeKillLogsModal();
            }
        }
    });

    // Initialize tooltip dynamically if not exist
    if (!document.getElementById('elo-hover-tooltip')) {
        const eloHoverTooltip = document.createElement('div');
        eloHoverTooltip.id = 'elo-hover-tooltip';
        eloHoverTooltip.style.cssText = 'position:fixed; display:none; background:rgba(20,20,25,0.95); backdrop-filter:blur(6px); border:1px solid rgba(74, 222, 128, 0.4); color:#4ade80; padding:6px 12px; border-radius:6px; pointer-events:none; font-weight:bold; font-size:13px; font-family:monospace; z-index:99999; box-shadow:0 8px 16px rgba(74, 222, 128, 0.15); transition: opacity 0.1s;';
        document.body.appendChild(eloHoverTooltip);
        
        window.showEloTooltip = function(e, text) {
            const tooltip = document.getElementById('elo-hover-tooltip');
            tooltip.innerHTML = text;
            tooltip.style.display = 'block';
            tooltip.style.left = (e.clientX + 15) + 'px';
            tooltip.style.top = (e.clientY - 15) + 'px';
        };
        window.hideEloTooltip = function() {
            const tooltip = document.getElementById('elo-hover-tooltip');
            if (tooltip) tooltip.style.display = 'none';
        };
        window.moveEloTooltip = function(e) {
            const tooltip = document.getElementById('elo-hover-tooltip');
            if (tooltip && tooltip.style.display === 'block') {
                tooltip.style.left = (e.clientX + 15) + 'px';
                tooltip.style.top = (e.clientY - 15) + 'px';
            }
        };
    }

    // Theme Switcher Logic
    const themeBtns = document.querySelectorAll('.theme-btn');
    const savedTheme = localStorage.getItem('quartz-theme') || 'abyss';
    
    function setTheme(theme) {
        document.body.className = theme === 'abyss' ? '' : `theme-${theme}`;
        themeBtns.forEach(btn => {
            btn.classList.toggle('active', btn.dataset.theme === theme);
        });
        localStorage.setItem('quartz-theme', theme);
        renderAll(); // Re-render to update graph colors
    }

    themeBtns.forEach(btn => {
        btn.addEventListener('click', () => setTheme(btn.dataset.theme));
    });

    setTheme(savedTheme);
    updateAllData();
    setInterval(updateAllData, 30000);
    window.handleChartHover = function(e, crosshairId, text, svgX) {
        const crosshair = document.getElementById(crosshairId);
        if (crosshair) {
            const container = crosshair.parentElement;
            const rect = container.getBoundingClientRect();
            // Convert SVG 1000 coordinate back to pixel percentage
            const pct = (svgX / 1000) * 100;
            crosshair.style.left = `${pct}%`;
        }
        showEloTooltip(e, text);
    };

    window.hideChartHover = function(crosshairId) {
        hideEloTooltip();
    };

    /**
     * Renders the Live Events Tab with search filtering
     */
    function renderEvents() {
        const fullFeed = document.getElementById('events-feed-container');
        if (!fullFeed) return;

        const query = (searchInput.value || '').toLowerCase();
        
        // Sort players to determine rank context for each log
        const sortedP = [...players].sort((a, b) => (b.elo || 0) - (a.elo || 0));

        // Filter logs based on search query (username or details)
        const filteredLogs = liveLogs.filter(log => {
            if (!query) return true;
            return (log.user || '').toLowerCase().includes(query) || 
                   (log.details || '').toLowerCase().includes(query);
        });

        if (filteredLogs.length === 0) {
            fullFeed.innerHTML = `
                <div style="text-align: center; padding: 40px; color: var(--text-muted);">
                    <i class="fa-solid fa-magnifying-glass" style="font-size: 2rem; margin-bottom: 15px; opacity: 0.3;"></i>
                    <p>No events found for "${searchInput.value}"</p>
                </div>
            `;
            return;
        }

        fullFeed.innerHTML = filteredLogs.map(log => {
            const timeStr = new Date(log.time * 1000).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit', second:'2-digit'});
            let icon = '<i class="fa-solid fa-bolt"></i>';
            let cardClass = 'event-log-card';
            let valueStr = '';
            
            // Rank Tier Logic
            const pIdx = sortedP.findIndex(p => p.username === log.user);
            const playerRank = pIdx === -1 ? 0 : pIdx + 1;
            
            let tierClass = 'event-rank-regular';
            let tagClass = 'tag-regular';
            let tagText = playerRank > 0 ? '#' + playerRank : 'UNRANKED';

            if (playerRank > 0 && playerRank <= 10) { tierClass = 'event-rank-top10'; tagClass = 'tag-top10'; }
            else if (playerRank > 10 && playerRank <= 50) { tierClass = 'event-rank-top50'; tagClass = 'tag-top50'; }
            else if (playerRank > 50 && playerRank <= 100) { tierClass = 'event-rank-top100'; tagClass = 'tag-top100'; }
            else if (playerRank > 100 && playerRank <= 250) { tierClass = 'event-rank-top250'; tagClass = 'tag-top250'; }

            cardClass += ' ' + tierClass;

            if (log.type === 'PROMOTED') {
                cardClass += ' event-card-rankup'; 
                icon = '<i class="fa-solid fa-angles-up"></i>'; 
                valueStr = `<span style="opacity: 0.7; font-size: 0.9rem;">RANK UP:</span> ${log.details}`;
            } else if (log.type === 'DEMOTED') {
                cardClass += ' event-card-rankdown'; 
                icon = '<i class="fa-solid fa-angles-down"></i>'; 
                valueStr = `<span style="opacity: 0.7; font-size: 0.9rem;">RANK DOWN:</span> ${log.details}`;
            } else if (log.type === 'STEAL') {
                cardClass += ' event-card-steal';
                icon = '<i class="fa-solid fa-crown" style="color:#fbbf24;"></i>';
                valueStr = `<span style="color:#fbbf24; font-weight:800;">RANK STEAL:</span> ${log.details}`;
            } else if (log.type === 'WHITELISTED') {
                cardClass += ' event-card-whitelist';
                icon = '<i class="fa-solid fa-user-plus" style="color:#3b82f6;"></i>';
                valueStr = `<span style="color:#3b82f6; font-weight:800;">WHITELISTED:</span> ${log.details}`;
            } else if (log.change >= 0) {
                cardClass += ' event-card-gain'; icon = '<i class="fa-solid fa-arrow-trend-up"></i>'; valueStr = '+' + log.change + ' Elo';
            } else {
                cardClass += ' event-card-loss'; icon = '<i class="fa-solid fa-arrow-trend-down"></i>'; valueStr = log.change + ' Elo';
            }
            
            return `
            <div class="console-log-line ${tierClass}">
                <span class="log-timestamp">[${timeStr}]</span>
                <span class="log-indicator" style="color:${log.change >= 0 ? '#10b981' : '#ef4444'}">●</span>
                <span class="log-user-tag">${log.user}</span>
                <span class="log-tag ${tagClass}">${tagText}</span>
                <span class="log-action">${log.type === 'PROMOTED' || log.type === 'DEMOTED' ? 'RANK_TRANSITION' : 'ELO_SHIFT'}</span>
                <span class="log-details">${log.details}</span>
                <span class="log-value" style="color:${log.change >= 0 ? '#10b981' : '#ef4444'}">${valueStr}</span>
            </div>`;
        }).join('');
    }

    function getWeaponIcon(weapon) {
        if (!weapon || weapon === 'None') return 'fa-shield-halved';
        const w = weapon.toLowerCase();
        if (w.includes('sword')) return 'fa-shield-halved'; // fa-khanda is Pro, sticking to free
        if (w.includes('axe')) return 'fa-gavel'; // free alternative to fa-axe
        if (w.includes('bow')) return 'fa-location-arrow'; // free alternative to fa-bow-arrow
        if (w.includes('trident')) return 'fa-anchor'; // free alternative to fa-trident
        if (w.includes('crossbow')) return 'fa-bullseye';
        if (w.includes('mace')) return 'fa-hammer';
        return 'fa-shield-halved';
    }
});
