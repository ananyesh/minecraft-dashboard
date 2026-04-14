document.addEventListener('DOMContentLoaded', () => {
    // State Management
    let players = [];
    let selectedPlayer = null;
    let currentSort = 'none';

    // Configuration: Replace with your Firebase URL
    const firebaseURL = 'https://minecraftstats-5f79c-default-rtdb.asia-southeast1.firebasedatabase.app/stats.json';

    // DOM Elements
    const playerGrid = document.getElementById('player-grid');
    const searchInput = document.getElementById('player-search');
    const sortBySelect = document.getElementById('sort-by');
    const detailsPanel = document.getElementById('details-panel');
    const closePanelBtn = document.getElementById('close-details');
    const onlineCountLabel = document.getElementById('online-count');
    const refreshBtn = document.getElementById('btn-refresh');

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

    /**
     * Fetch player data from Firebase
     */
    async function updateStats() {
        if (firebaseURL.includes('your-project')) {
            console.log('Firebase URL not configured. Using mock data.');
            players = window.minecraftData || [];
            renderPlayers();
            return;
        }

        try {
            const response = await fetch(firebaseURL);
            if (response.ok) {
                const data = await response.json();
                players = data || [];
                renderPlayers();
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
                const totalA = Object.values(a.stats['minecraft:mined']).reduce((sum, val) => sum + val, 0);
                const totalB = Object.values(b.stats['minecraft:mined']).reduce((sum, val) => sum + val, 0);
                return totalB - totalA;
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
            const totalMined = Object.values(player.stats['minecraft:mined']).reduce((sum, val) => sum + val, 0);

            return `
                <div class="player-card" onclick="showPlayerDetails('${player.uuid}')">
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

        const mined = player.stats['minecraft:mined'];
        const totalMined = Object.values(mined).reduce((sum, val) => sum + val, 0);
        statMined.textContent = totalMined;
        statDiamonds.textContent = mined['minecraft:diamond_ore'] || 0;
        statStone.textContent = mined['minecraft:stone'] || 0;
        
        statPlayerKills.textContent = player.stats['minecraft:custom']['minecraft:player_kills'] || 0;
        statMobKills.textContent = player.stats['minecraft:custom']['minecraft:mob_kills'] || 0;

        renderMiningGraph(mined);
        
        detailsPanel.classList.add('open');
    };

    /**
     * Render mini bar graph for mining stats
     */
    function renderMiningGraph(mined) {
        const blocks = [
            { key: 'minecraft:diamond_ore', label: 'Diamond', class: 'bar-diamond' },
            { key: 'minecraft:iron_ore', label: 'Iron', class: 'bar-iron' },
            { key: 'minecraft:gold_ore', label: 'Gold', class: 'bar-gold' },
            { key: 'minecraft:coal_ore', label: 'Coal', class: 'bar-coal' },
            { key: 'minecraft:emerald_ore', label: 'Emerald', class: 'bar-emerald' },
            { key: 'minecraft:redstone_ore', label: 'Redstone', class: 'bar-redstone' },
            { key: 'minecraft:ancient_debris', label: 'Netherite', class: 'bar-ancient' },
            { key: 'minecraft:stone', label: 'Stone', class: 'bar-stone' }
        ];

        // Find max for scaling
        const maxVal = Math.max(...blocks.map(b => mined[b.key] || 0), 1);

        miningGraph.innerHTML = blocks
            .filter(b => (mined[b.key] || 0) > 0)
            .map(block => {
                const val = mined[block.key] || 0;
                const percent = (val / maxVal) * 100;
                
                return `
                    <div class="graph-row">
                        <span class="graph-label">${block.label}</span>
                        <div class="bar-container">
                            <div class="bar-fill ${block.class}" style="width: ${percent}%"></div>
                        </div>
                        <span class="graph-value">${val}</span>
                    </div>
                `;
            }).join('');
            
        if (miningGraph.innerHTML === '') {
            miningGraph.innerHTML = '<div class="empty-msg">No mining data yet.</div>';
        }
    }

    // Event Listeners
    closePanelBtn.addEventListener('click', () => {
        detailsPanel.classList.remove('open');
    });

    searchInput.addEventListener('input', renderPlayers);
    
    sortBySelect.addEventListener('change', (e) => {
        currentSort = e.target.value;
        renderPlayers();
    });

    refreshBtn.addEventListener('click', updateStats);

    // Initial Load
    updateStats();
    
    // Auto-refresh every 30 seconds
    setInterval(updateStats, 30000);
});
