document.addEventListener('DOMContentLoaded', () => {
    // State Management
    let players = [];
    let selectedPlayer = null;
    let currentSort = 'none';

    // Configuration: Point to the 'players' object instead of the root
    const firebaseURL = 'https://minecraftstats-5f79c-default-rtdb.asia-southeast1.firebasedatabase.app/players.json';

    // DOM Elements
    const playerGrid = document.getElementById('player-grid');
    const searchInput = document.getElementById('player-search');
    const sortBySelect = document.getElementById('sort-by');
    const detailsPanel = document.getElementById('details-panel');
    const closePanelBtn = document.getElementById('close-details');
    const onlineCountLabel = document.getElementById('online-count');
    const refreshBtn = document.getElementById('btn-refresh');
    
    // Nav Elements
    const navPlayers = document.getElementById('nav-players');
    const navLeaderboards = document.getElementById('nav-leaderboards');

    // Stats Elements
    const detailUsername = document.getElementById('detail-username');
    const detailAvatar = document.getElementById('detail-avatar-body');
    const statPlaytime = document.getElementById('stat-playtime');
    const statDeaths = document.getElementById('stat-deaths');
    const statKills = document.getElementById('stat-kills');
    const statKD = document.getElementById('stat-kd');
    const statMined = document.getElementById('stat-mined');
    const statDiamonds = document.getElementById('stat-diamonds');
    const statStone = document.getElementById('stat-stone');
    const statPlayerKills = document.getElementById('stat-player-kills');
    const statMobKills = document.getElementById('stat-mob-kills');
    const miningGraph = document.getElementById('mining-graph');
    const combatGraph = document.getElementById('combat-graph');

    /**
     * Fetch player data from Firebase
     */
    async function updateStats() {
        try {
            const response = await fetch(firebaseURL);
            if (response.ok) {
                const data = await response.json();
                // Convert Firebase object {uuid: data} to array [{...data}]
                players = data ? Object.values(data) : [];
                renderPlayers();
                
                // Refresh detail panel if open
                if (selectedPlayer) {
                    const updated = players.find(p => p.uuid === selectedPlayer.uuid);
                    if (updated) showPlayerDetails(updated.uuid);
                }
            } else {
                players = window.minecraftData || [];
                renderPlayers();
            }
        } catch (error) {
            console.error('Error fetching stats:', error);
            players = window.minecraftData || [];
            renderPlayers();
        }
    }

    /**
     * Sort players based on current selection
     */
    function getSortedPlayers() {
        let sorted = [...players];
        
        if (currentSort === 'playtime') {
            sorted.sort((a, b) => (b.stats['minecraft:custom']['minecraft:play_one_minute'] || 0) - (a.stats['minecraft:custom']['minecraft:play_one_minute'] || 0));
        } else if (currentSort === 'kills') {
            sorted.sort((a, b) => (b.stats['minecraft:custom']['minecraft:player_kills'] || 0) - (a.stats['minecraft:custom']['minecraft:player_kills'] || 0));
        } else if (currentSort === 'deaths') {
            sorted.sort((a, b) => (b.stats['minecraft:custom']['minecraft:deaths'] || 0) - (a.stats['minecraft:custom']['minecraft:deaths'] || 0));
        } else if (currentSort === 'mined') {
            sorted.sort((a, b) => {
                const totalA = Object.values(a.stats['minecraft:mined'] || {}).reduce((sum, val) => sum + val, 0);
                const totalB = Object.values(b.stats['minecraft:mined'] || {}).reduce((sum, val) => sum + val, 0);
                return totalB - totalA;
            });
        } else {
            // Default: Online players first, then alphabetically
            sorted.sort((a, b) => {
                if (a.online !== b.online) return b.online ? 1 : -1;
                return a.username.localeCompare(b.username);
            });
        }
        
        return sorted;
    }

    /**
     * Render player cards to the grid
     */
    function renderPlayers() {
        const searchTerm = searchInput.value.toLowerCase();
        const sortedPlayers = getSortedPlayers();
        
        const filteredPlayers = sortedPlayers.filter(p => 
            p.username.toLowerCase().includes(searchTerm)
        );

        playerGrid.innerHTML = filteredPlayers.map(player => {
            const playtimeHours = Math.floor((player.stats['minecraft:custom']['minecraft:play_one_minute'] || 0) / 20 / 60 / 60);
            const totalMined = Object.values(player.stats['minecraft:mined'] || {}).reduce((sum, val) => sum + val, 0);

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

    /**
     * Friendly Name Helper
     */
    function formatName(raw) {
        return raw.toLowerCase().split('_').map(word => word.charAt(0).toUpperCase() + word.slice(1)).join(' ');
    }

    /**
     * Show player details panel
     */
    window.showPlayerDetails = (uuid) => {
        const player = players.find(p => p.uuid === uuid);
        if (!player) return;

        selectedPlayer = player;
        
        // Update basic info
        detailUsername.textContent = player.username;
        detailAvatar.src = `https://mc-heads.net/body/${player.uuid}/160`;
        
        // Update stats
        const playtimeTicks = player.stats['minecraft:custom']['minecraft:play_one_minute'] || 0;
        statPlaytime.textContent = `${Math.floor(playtimeTicks / 20 / 60 / 60)}h`;
        statDeaths.textContent = player.stats['minecraft:custom']['minecraft:deaths'] || 0;
        statKills.textContent = player.stats['minecraft:custom']['minecraft:player_kills'] || 0;
        
        const kills = player.stats['minecraft:custom']['minecraft:player_kills'] || 0;
        const deaths = player.stats['minecraft:custom']['minecraft:deaths'] || 1;
        statKD.textContent = (kills / deaths).toFixed(2);

        const mined = player.stats['minecraft:mined'] || {};
        const totalMined = Object.values(mined).reduce((sum, val) => sum + val, 0);
        statMined.textContent = totalMined;
        
        statDiamonds.textContent = (mined['DIAMOND_ORE'] || 0) + (mined['DEEPSLATE_DIAMOND_ORE'] || 0);
        statStone.textContent = (mined['STONE'] || 0) + (mined['DEEPSLATE'] || 0);
        
        statPlayerKills.textContent = player.stats['minecraft:custom']['minecraft:player_kills'] || 0;
        statMobKills.textContent = player.stats['minecraft:custom']['minecraft:mob_kills'] || 0;

        // Render Graphs
        renderStatChart(miningGraph, mined, 'bar-stone');
        renderStatChart(combatGraph, player.stats['minecraft:killed'] || {}, 'bar-emerald');
        
        detailsPanel.classList.add('open');
    };

    /**
     * Render a generic bar chart
     */
    function renderStatChart(container, dataMap, defaultClass) {
        if (!dataMap || Object.keys(dataMap).length === 0) {
            container.innerHTML = '<div class="empty-msg">No data available yet.</div>';
            return;
        }

        const items = Object.entries(dataMap)
            .map(([name, count]) => ({ name, count }))
            .sort((a, b) => b.count - a.count)
            .slice(0, 10);

        const maxVal = Math.max(...items.map(i => i.count), 1);

        container.innerHTML = items.map(item => {
            const percent = (item.count / maxVal) * 100;
            const barClass = getContextClass(item.name, defaultClass);
            
            return `
                <div class="graph-row">
                    <span class="graph-label">${formatName(item.name)}</span>
                    <div class="bar-container">
                        <div class="bar-fill ${barClass}" style="width: ${percent}%"></div>
                    </div>
                    <span class="graph-value">${item.count}</span>
                </div>
            `;
        }).join('');
    }

    function getContextClass(name, defaultClass) {
        if (name.includes('DIAMOND')) return 'bar-diamond';
        if (name.includes('GOLD')) return 'bar-gold';
        if (name.includes('IRON')) return 'bar-iron';
        if (name.includes('COAL')) return 'bar-coal';
        if (name.includes('EMERALD')) return 'bar-emerald';
        if (name.includes('REDSTONE')) return 'bar-redstone';
        if (name.includes('LAPIS')) return 'bar-lapis';
        if (name.includes('ANCIENT_DEBRIS')) return 'bar-ancient';
        return defaultClass;
    }

    // Event Listeners
    closePanelBtn.addEventListener('click', () => {
        detailsPanel.classList.remove('open');
        selectedPlayer = null;
    });

    searchInput.addEventListener('input', renderPlayers);
    
    sortBySelect.addEventListener('change', (e) => {
        currentSort = e.target.value;
        renderPlayers();
    });

    // Sidebar Navigation
    navPlayers.addEventListener('click', () => {
        navPlayers.classList.add('active');
        navLeaderboards.classList.remove('active');
        searchInput.value = '';
        currentSort = 'none';
        sortBySelect.value = 'none';
        renderPlayers();
        window.scrollTo({ top: 0, behavior: 'smooth' });
    });

    navLeaderboards.addEventListener('click', () => {
        navLeaderboards.classList.add('active');
        navPlayers.classList.remove('active');
        // Select 'Mined' as default leaderboard
        currentSort = 'mined';
        sortBySelect.value = 'mined';
        renderPlayers();
        
        // Scroll to the leaderboard section
        const viewport = document.querySelector('.viewport');
        viewport.scrollIntoView({ behavior: 'smooth' });
    });

    refreshBtn.addEventListener('click', updateStats);

    // Initial Load
    updateStats();
    setInterval(updateStats, 30000);
});
