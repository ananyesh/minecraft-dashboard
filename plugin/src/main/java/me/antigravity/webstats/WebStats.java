package me.antigravity.webstats;

import org.bukkit.Bukkit;
import org.bukkit.Material;
import org.bukkit.Statistic;
import org.bukkit.entity.EntityType;
import org.bukkit.entity.Player;
import org.bukkit.event.EventHandler;
import org.bukkit.event.Listener;
import org.bukkit.event.player.PlayerJoinEvent;
import org.bukkit.event.player.PlayerQuitEvent;
import org.bukkit.plugin.java.JavaPlugin;
import org.bukkit.scheduler.BukkitRunnable;

import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.time.Duration;
import java.util.LinkedList;

public class WebStats extends JavaPlugin implements Listener {

    private String databaseURL;
    private final HttpClient httpClient = HttpClient.newBuilder()
            .connectTimeout(Duration.ofSeconds(10))
            .build();

    private final LinkedList<String> pulseHistory = new LinkedList<>();
    private long lastTick = System.currentTimeMillis();
    private double currentTps = 20.0;

    @Override
    public void onEnable() {
        saveDefaultConfig();
        loadConfig();
        getServer().getPluginManager().registerEvents(this, this);

        // TPS Monitor
        new BukkitRunnable() {
            @Override
            public void run() {
                long now = System.currentTimeMillis();
                long diff = now - lastTick;
                double instantTps = 1000.0 / Math.max(diff, 1);
                currentTps = (currentTps * 0.9) + (Math.min(instantTps, 20.0) * 0.1);
                lastTick = now;
            }
        }.runTaskTimer(this, 1L, 1L);

        // Periodic Sync (Every 10s)
        new BukkitRunnable() {
            @Override
            public void run() {
                syncServerStats(true);
                for (Player player : Bukkit.getOnlinePlayers()) {
                    syncPlayer(player, true);
                }
            }
        }.runTaskTimerAsynchronously(this, 100L, 200L);

        // History Pulse (Every 1m)
        new BukkitRunnable() {
            @Override
            public void run() {
                recordAdvancedPulse();
            }
        }.runTaskTimerAsynchronously(this, 1200L, 1200L);
    }

    /**
     * Safety Shutdown Logic:
     * When the server stops or restarts, we must force everyone to "Offline"
     * so they don't stay phantom online on the dashboard.
     */
    @Override
    public void onDisable() {
        getLogger().info("WebStats shutting down. Syncing final status...");
        
        // Mark server as offline
        syncServerStats(false);

        // Mark all players as offline
        for (Player player : Bukkit.getOnlinePlayers()) {
            syncPlayer(player, false);
        }
    }

    private void loadConfig() {
        String fullUrl = getConfig().getString("firebase-url", "");
        databaseURL = fullUrl.replace("/stats.json", "").replaceAll("/$", "");
    }

    @EventHandler
    public void onJoin(PlayerJoinEvent event) {
        syncPlayer(event.getPlayer(), true);
    }

    @EventHandler
    public void onQuit(PlayerQuitEvent event) {
        syncPlayer(event.getPlayer(), false);
    }

    private void syncServerStats(boolean online) {
        if (databaseURL.isEmpty() || databaseURL.contains("your-project")) return;
        long mspt = calculateMSPT();
        String json = String.format("{\"tps\":%.2f, \"mspt\":%d, \"players_online\":%d, \"players_max\":%d, \"status\":\"%s\"}", 
                currentTps, mspt, Bukkit.getOnlinePlayers().size(), Bukkit.getMaxPlayers(), online ? "online" : "offline");
        
        // We use sendCloudUpdate which is async, but onDisable might finish before it completes.
        // For onDisable, ideally we'd use a synchronous call, but since Spigot gives plugins 
        // a moment to shutdown, async with a short timeout often works.
        sendCloudUpdate(databaseURL + "/server/health.json", json, "PATCH");
    }

    private long calculateMSPT() {
        try {
            return (long) Bukkit.class.getMethod("getAverageTickTime").invoke(null);
        } catch (Exception e) {
            return (long) (50.0 * (20.0 / Math.max(0.1, currentTps)));
        }
    }

    private void recordAdvancedPulse() {
        String dataPoint = String.format("{\"p\":%d, \"t\":%.2f, \"m\":%d, \"ts\":%d}", 
                Bukkit.getOnlinePlayers().size(), currentTps, calculateMSPT(), System.currentTimeMillis() / 1000);
        pulseHistory.add(dataPoint);
        if (pulseHistory.size() > 60) pulseHistory.removeFirst();
        String json = "[" + String.join(",", pulseHistory) + "]";
        sendCloudUpdate(databaseURL + "/server/history.json", json, "PUT");
    }

    private void syncPlayer(Player player, boolean online) {
        if (databaseURL.isEmpty() || databaseURL.contains("your-project")) return;

        String uuid = player.getUniqueId().toString();
        
        int mined = 0;
        int placed = 0;
        for (Material m : Material.values()) {
            if (m.isBlock()) {
                try {
                    mined += player.getStatistic(Statistic.MINE_BLOCK, m);
                    placed += player.getStatistic(Statistic.USE_ITEM, m);
                } catch (Exception ignored) {}
            }
        }

        StringBuilder json = new StringBuilder("{");
        json.append("\"username\":\"").append(player.getName()).append("\",")
            .append("\"uuid\":\"").append(uuid).append("\",")
            .append("\"online\":").append(online).append(",")
            .append("\"stats\":{")
            .append("\"total_mined\":").append(mined).append(",")
            .append("\"total_placed\":").append(placed).append(",")
            .append("\"minecraft:custom\":{");

        boolean first = true;
        for (Statistic s : Statistic.values()) {
            if (s.getType() == Statistic.Type.UNTYPED) {
                try {
                    int val = player.getStatistic(s);
                    if (val > 0) {
                        if (!first) json.append(",");
                        json.append("\"").append(s.name()).append("\":").append(val);
                        first = false;
                    }
                } catch (Exception ignored) {}
            }
        }
        json.append("},");

        json.append("\"minecraft:mined\":{");
        first = true;
        for (Material m : Material.values()) {
            if (m.isBlock()) {
                try {
                    int val = player.getStatistic(Statistic.MINE_BLOCK, m);
                    if (val > 0) {
                        if (!first) json.append(",");
                        json.append("\"").append(m.name()).append("\":").append(val);
                        first = false;
                    }
                } catch (Exception ignored) {}
            }
        }
        json.append("},");

        json.append("\"minecraft:killed\":{");
        first = true;
        for (EntityType type : EntityType.values()) {
            if (type.isAlive()) {
                try {
                    int val = player.getStatistic(Statistic.KILL_ENTITY, type);
                    if (val > 0) {
                        if (!first) json.append(",");
                        json.append("\"").append(type.name()).append("\":").append(val);
                        first = false;
                    }
                } catch (Exception ignored) {}
            }
        }
        json.append("}}}");

        sendCloudUpdate(databaseURL + "/players/" + uuid + ".json", json.toString(), "PATCH");
    }

    private void sendCloudUpdate(String url, String json, String method) {
        HttpRequest request = HttpRequest.newBuilder()
                .uri(URI.create(url))
                .header("Content-Type", "application/json")
                .method(method, HttpRequest.BodyPublishers.ofString(json))
                .build();
        httpClient.sendAsync(request, HttpResponse.BodyHandlers.ofString());
    }
}
