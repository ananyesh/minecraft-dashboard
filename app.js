document.addEventListener('DOMContentLoaded', () => {
    // State Management
    let players = [];
    let selectedPlayer = null;
    // Configuration: Replace with your Firebase URL from the Firebase Console
    // Example: 'https://your-project.firebaseio.com/stats.json'
    const firebaseURL = 'https://minecraftstats-5f79c-default-rtdb.asia-southeast1.firebasedatabase.app/stats.json';

    // DOM Elements
    const playerGrid = document.getElementById('player-grid');
    const searchInput = document.getElementById('player-search');
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
                players = data || []; // Handle null if database is empty
                renderPlayers();
            } else {
                console.log('Using mock data fallback...');
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
     * Render the grid of player cards
     */
    function renderPlayers() {
        const searchTerm = searchInput.value.toLowerCase();
        const filtered = players.filter(p => p.username.toLowerCase().includes(searchTerm));

        playerGrid.innerHTML = '';
        
        let onlineCount = 0;
        filtered.forEach((player, index) => {
            if (player.online) onlineCount++;
            
            const card = document.createElement('div');
            card.className = 'player-card';
            card.style.animationDelay = `${index * 0.05}s`;
            
            const uuid = player.uuid;
            const avatarUrl = `https://mc-heads.net/avatar/${uuid}/100`;
            const mined = player.stats['minecraft:mined'] 
                ? Object.values(player.stats['minecraft:mined']).reduce((a, b) => a + b, 0) 
                : 0;
            const kills = player.stats['minecraft:custom']?.['minecraft:player_kills'] || 0;

            card.innerHTML = `
                <div class="p-avatar">
                    <img src="${avatarUrl}" alt="${player.username}">
                </div>
                <div class="p-name">${player.username}</div>
                <div class="p-status ${player.online ? 'online' : 'offline'}">
                    ${player.online ? 'Online' : 'Offline'}
                </div>
                <div class="p-quick-stats">
                    <div class="stat-item">
                        <span class="val">${mined.toLocaleString()}</span>
                        <span class="lab">Mined</span>
                    </div>
                    <div class="stat-item">
                        <span class="val">${kills}</span>
                        <span class="lab">Kills</span>
                    </div>
                </div>
            `;

            card.addEventListener('click', () => openDetails(player));
            playerGrid.appendChild(card);
        });

        onlineCountLabel.textContent = `${onlineCount}/${players.length}`;
    }

    /**
     * Open the side panel with detailed statistics
     */
    function openDetails(player) {
        selectedPlayer = player;
        const customStats = player.stats['minecraft:custom'] || {};
        const minedStats = player.stats['minecraft:mined'] || {};

        // General Info
        detailUsername.textContent = player.username;
        detailAvatar.src = `https://mc-heads.net/body/${player.uuid}/300`;
        
        // General Stats
        const playtimeTicks = customStats['minecraft:play_one_minute'] || 0;
        const hours = Math.floor(playtimeTicks / 20 / 3600);
        statPlaytime.textContent = `${hours}h`;
        
        const deaths = customStats['minecraft:deaths'] || 0;
        const kills = customStats['minecraft:player_kills'] || 0;
        statDeaths.textContent = deaths;
        statKills.textContent = kills;
        statKD.textContent = deaths === 0 ? kills.toFixed(2) : (kills / deaths).toFixed(2);

        // Mining stats
        const totalMined = Object.values(minedStats).reduce((a, b) => a + b, 0);
        statMined.textContent = totalMined.toLocaleString();
        statDiamonds.textContent = (minedStats['minecraft:diamond_ore'] || 0) + (minedStats['minecraft:deepslate_diamond_ore'] || 0);
        statStone.textContent = (minedStats['minecraft:stone'] || 0).toLocaleString();

        // Combat
        statPlayerKills.textContent = customStats['minecraft:player_kills'] || 0;
        statMobKills.textContent = customStats['minecraft:mob_kills'] || 0;

        detailsPanel.classList.add('open');
    }

    // Event Listeners
    searchInput.addEventListener('input', renderPlayers);
    closePanelBtn.addEventListener('click', () => detailsPanel.classList.remove('open'));
    refreshBtn.addEventListener('click', updateStats);

    // Initial Load
    updateStats();
    // Poll for updates every 10 seconds
    setInterval(updateStats, 10000);
});
